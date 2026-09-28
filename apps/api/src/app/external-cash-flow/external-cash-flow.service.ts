import { PortfolioChangedEvent } from '@ghostfolio/api/events/portfolio-changed.event';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExternalCashFlowType, Prisma } from '@prisma/client';
import { Big } from 'big.js';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { parseISO } from 'date-fns';
import { randomUUID } from 'node:crypto';

import {
  CreateExternalCashFlowDto,
  GetExternalCashFlowsDto,
  TransferExternalCashFlowDto,
  UpdateExternalCashFlowDto
} from './external-cash-flow.dto';
import { resolveExternalCashFlows } from './resolve-external-cash-flows';
import { validateTransferPair } from './transfer.helper';

export function accountingDate(date: string) {
  return parseISO(`${date}T00:00:00.000Z`);
}

@Injectable()
export class ExternalCashFlowService {
  public constructor(
    private readonly prismaService: PrismaService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  public async list(userId: string, input: GetExternalCashFlowsDto) {
    const { accounts, from, to, skip, take } = this.validate(
      GetExternalCashFlowsDto,
      input
    );
    this.checkInterval(from, to);
    const where: Prisma.ExternalCashFlowWhereInput = {
      userId,
      accountId: accounts ? { in: accounts } : undefined,
      date: this.dateFilter(from, to)
    };
    const [items, count] = await this.prismaService.$transaction(
      [
        this.prismaService.externalCashFlow.findMany({
          where,
          skip,
          take,
          orderBy: [{ date: 'asc' }, { id: 'asc' }]
        }),
        this.prismaService.externalCashFlow.count({ where })
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
    return { count, items };
  }

  public async get(userId: string, id: string) {
    return this.requireFlow(this.prismaService, userId, id);
  }

  public async resolveForScope(
    userId: string,
    input: GetExternalCashFlowsDto & { accounts: string[] }
  ) {
    const { accounts, from, to } = this.validate(
      GetExternalCashFlowsDto,
      input
    );
    this.checkInterval(from, to);
    if (!accounts) {
      throw new BadRequestException('Explicit account scope required');
    }
    // Read matching legs and their counterparts in one consistent snapshot.
    return this.prismaService.$transaction(
      async (tx) => {
        await this.requireAccounts(tx, userId, accounts);
        const selected = await tx.externalCashFlow.findMany({
          where: {
            userId,
            accountId: { in: accounts },
            date: this.dateFilter(from, to)
          }
        });
        const groupIds = [
          ...new Set(
            selected
              .map(({ transferGroupId }) => transferGroupId)
              .filter((id): id is string => !!id)
          )
        ];
        const counterparts = groupIds.length
          ? await tx.externalCashFlow.findMany({
              where: { userId, transferGroupId: { in: groupIds } }
            })
          : [];
        return resolveExternalCashFlows({
          userId,
          flows: [
            ...selected.filter(({ transferGroupId }) => !transferGroupId),
            ...counterparts
          ],
          accountIds: accounts,
          from: from ? accountingDate(from) : undefined,
          to: to ? accountingDate(to) : undefined
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }

  public async create(userId: string, input: CreateExternalCashFlowDto) {
    const data = this.validate(CreateExternalCashFlowDto, input);
    return this.mutate(userId, async (tx) => {
      await this.requireAccounts(tx, userId, [data.accountId]);
      return tx.externalCashFlow.create({
        data: {
          ...data,
          userId,
          date: accountingDate(data.date),
          amount: new Prisma.Decimal(data.amount)
        }
      });
    });
  }

  public async update(
    userId: string,
    id: string,
    input: UpdateExternalCashFlowDto
  ) {
    const data = this.validate(UpdateExternalCashFlowDto, input);
    return this.mutate(userId, async (tx) => {
      const original = await this.requireOrdinaryFlow(tx, userId, id);
      await this.requireAccounts(tx, userId, [
        data.accountId ?? original.accountId
      ]);
      return tx.externalCashFlow.update({
        where: { id, userId },
        data: {
          ...data,
          date: data.date === undefined ? undefined : accountingDate(data.date),
          amount:
            data.amount === undefined
              ? undefined
              : new Prisma.Decimal(data.amount)
        }
      });
    });
  }

  public async delete(userId: string, id: string) {
    return this.mutate(userId, async (tx) => {
      await this.requireOrdinaryFlow(tx, userId, id);
      return tx.externalCashFlow.delete({ where: { id, userId } });
    });
  }

  public async createTransfer(
    userId: string,
    input: TransferExternalCashFlowDto
  ) {
    const data = this.validateTransfer(input);
    const transferGroupId = randomUUID();
    return this.mutate(userId, async (tx) => {
      await this.requireAccounts(tx, userId, [
        data.from.accountId,
        data.to.accountId
      ]);
      const outgoing = await tx.externalCashFlow.create({
        data: this.transferLeg(userId, transferGroupId, data, 'TRANSFER_OUT')
      });
      const incoming = await tx.externalCashFlow.create({
        data: this.transferLeg(userId, transferGroupId, data, 'TRANSFER_IN')
      });
      return { transferGroupId, items: [outgoing, incoming] };
    });
  }

  public async updateTransfer(
    userId: string,
    transferGroupId: string,
    input: TransferExternalCashFlowDto
  ) {
    const data = this.validateTransfer(input);
    return this.mutate(userId, async (tx) => {
      const { outgoing, incoming } = await this.requirePair(
        tx,
        userId,
        transferGroupId
      );
      await this.requireAccounts(tx, userId, [
        data.from.accountId,
        data.to.accountId
      ]);
      const from = await tx.externalCashFlow.update({
        where: { id: outgoing.id, userId },
        data: this.transferLeg(userId, transferGroupId, data, 'TRANSFER_OUT')
      });
      const to = await tx.externalCashFlow.update({
        where: { id: incoming.id, userId },
        data: this.transferLeg(userId, transferGroupId, data, 'TRANSFER_IN')
      });
      return { transferGroupId, items: [from, to] };
    });
  }

  public async deleteTransfer(userId: string, transferGroupId: string) {
    return this.mutate(userId, async (tx) => {
      const { outgoing, incoming } = await this.requirePair(
        tx,
        userId,
        transferGroupId
      );
      await tx.externalCashFlow.delete({ where: { id: outgoing.id, userId } });
      await tx.externalCashFlow.delete({ where: { id: incoming.id, userId } });
      return { transferGroupId, items: [outgoing, incoming] };
    });
  }

  private dateFilter(from?: string, to?: string) {
    return {
      gte: from ? accountingDate(from) : undefined,
      lte: to ? accountingDate(to) : undefined
    };
  }

  private checkInterval(from?: string, to?: string) {
    if (from && to && from > to) {
      throw new BadRequestException('Invalid date interval');
    }
  }

  private async mutate<T>(
    userId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    let result: T;
    try {
      result = await this.prismaService.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2003', 'P2025', 'P2034'].includes(error.code)
      ) {
        throw new ConflictException(
          'Cash-flow mutation conflict; reload and retry'
        );
      }
      throw error;
    }
    this.eventEmitter.emit(
      PortfolioChangedEvent.getName(),
      new PortfolioChangedEvent({ userId })
    );
    return result;
  }

  private async requireAccounts(
    tx: Prisma.TransactionClient,
    userId: string,
    ids: string[]
  ) {
    const accountIds = [...new Set(ids)];
    const count = await tx.account.count({
      where: { userId, id: { in: accountIds } }
    });
    if (count !== accountIds.length) {
      throw new NotFoundException();
    }
  }

  private async requireFlow(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string
  ) {
    const flow = await tx.externalCashFlow.findFirst({ where: { id, userId } });
    if (!flow) {
      throw new NotFoundException();
    }
    return flow;
  }

  private async requireOrdinaryFlow(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string
  ) {
    const flow = await this.requireFlow(tx, userId, id);
    if (
      flow.transferGroupId ||
      !['DEPOSIT', 'WITHDRAWAL'].includes(flow.type)
    ) {
      throw new ConflictException('Use the paired transfer endpoint');
    }
    return flow;
  }

  private async requirePair(
    tx: Prisma.TransactionClient,
    userId: string,
    transferGroupId: string
  ) {
    const flows = await tx.externalCashFlow.findMany({
      where: { userId, transferGroupId }
    });
    if (!flows.length) {
      throw new NotFoundException();
    }
    return validateTransferPair(flows, userId);
  }

  private transferLeg(
    userId: string,
    transferGroupId: string,
    data: TransferExternalCashFlowDto,
    type: ExternalCashFlowType
  ): Prisma.ExternalCashFlowUncheckedCreateInput {
    const leg = type === 'TRANSFER_OUT' ? data.from : data.to;
    return {
      userId,
      transferGroupId,
      type,
      accountId: leg.accountId,
      amount: new Prisma.Decimal(leg.amount),
      currency: leg.currency,
      date: accountingDate(leg.date),
      comment: data.comment ?? null,
      source: data.source ?? null
    };
  }

  private validateTransfer(input: TransferExternalCashFlowDto) {
    const data = this.validate(TransferExternalCashFlowDto, input);
    if (
      !data.from ||
      !data.to ||
      data.from.accountId === data.to.accountId ||
      data.from.date > data.to.date ||
      (data.from.currency === data.to.currency &&
        !new Big(data.from.amount).eq(data.to.amount))
    ) {
      throw new BadRequestException(
        'Invalid transfer principals, accounts or dates'
      );
    }
    return data;
  }

  private validate<T extends object>(dto: ClassConstructor<T>, input: T): T {
    const data = plainToInstance(dto, input);
    if (
      !data ||
      validateSync(data, { whitelist: true, forbidNonWhitelisted: true }).length
    ) {
      throw new BadRequestException('Invalid cash-flow input');
    }
    return data;
  }
}
