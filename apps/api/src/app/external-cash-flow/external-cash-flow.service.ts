import { PortfolioChangedEvent } from '@ghostfolio/api/events/portfolio-changed.event';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import type {
  ExternalCashFlowExportItem,
  ExternalCashFlowExportSection
} from '@ghostfolio/common/interfaces';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExternalCashFlow, ExternalCashFlowType, Prisma } from '@prisma/client';
import { Big } from 'big.js';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { parseISO } from 'date-fns';
import { createHash, randomUUID } from 'node:crypto';

import {
  ExternalCashFlowImportItemDto,
  ExternalCashFlowImportSectionDto
} from './external-cash-flow-import.dto';
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

function importUuid(userId: string, kind: 'flow' | 'group', sourceId: string) {
  const bytes = createHash('sha256')
    .update(`ghostfolio:external-cash-flow:${kind}:${userId}:${sourceId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] % 16) + 80;
  bytes[8] = (bytes[8] % 64) + 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

  public async getTransfer(userId: string, transferGroupId: string) {
    const { incoming, outgoing } = await this.requirePair(
      this.prismaService,
      userId,
      transferGroupId
    );

    return { transferGroupId, items: [outgoing, incoming] };
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

  public async exportSection({
    accountIds,
    endDate,
    startDate,
    userId
  }: {
    accountIds: string[];
    endDate?: Date;
    startDate?: Date;
    userId: string;
  }): Promise<ExternalCashFlowExportSection | undefined> {
    const candidates = await this.prismaService.externalCashFlow.findMany({
      where: {
        userId,
        accountId: { in: accountIds },
        date: { gte: startDate, lte: endDate }
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }]
    });
    if (!candidates.length) {
      return undefined;
    }
    const groupIds = [
      ...new Set(
        candidates
          .map(({ transferGroupId }) => transferGroupId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    const completeGroupRows = groupIds.length
      ? await this.prismaService.externalCashFlow.findMany({
          where: { userId, transferGroupId: { in: groupIds } }
        })
      : [];
    const candidateIds = new Set(candidates.map(({ id }) => id));
    const items = candidates.filter(({ transferGroupId }) => !transferGroupId);
    const incompleteTransferGroups: NonNullable<
      ExternalCashFlowExportSection['incompleteTransferGroups']
    > = [];

    for (const transferGroupId of groupIds) {
      const rows = completeGroupRows.filter(
        (flow) => flow.transferGroupId === transferGroupId
      );
      try {
        const pair = validateTransferPair(rows, userId);
        if (
          candidateIds.has(pair.outgoing.id) &&
          candidateIds.has(pair.incoming.id)
        ) {
          items.push(pair.outgoing, pair.incoming);
        } else {
          incompleteTransferGroups.push({
            transferGroupId,
            reason: 'COUNTERPART_OUTSIDE_EXPORT_SCOPE',
            selectedFlowIds: rows
              .filter(({ id }) => candidateIds.has(id))
              .map(({ id }) => id)
              .sort()
          });
        }
      } catch {
        incompleteTransferGroups.push({
          transferGroupId,
          reason: 'MALFORMED_TRANSFER_PAIR',
          selectedFlowIds: rows
            .filter(({ id }) => candidateIds.has(id))
            .map(({ id }) => id)
            .sort()
        });
      }
    }

    return {
      version: 1,
      items: items
        .sort(
          (a, b) =>
            a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id)
        )
        .map((flow): ExternalCashFlowExportItem => this.serializeExport(flow)),
      incompleteTransferGroups: incompleteTransferGroups.length
        ? incompleteTransferGroups
        : undefined
    };
  }

  public validateImportSection(
    input: ExternalCashFlowImportSectionDto,
    sourceAccountIds: string[]
  ) {
    const data = this.validate(ExternalCashFlowImportSectionDto, input);
    if (data.incompleteTransferGroups?.length) {
      throw new BadRequestException(
        'External cash-flow export contains incomplete transfer groups'
      );
    }
    const accounts = new Set(sourceAccountIds);
    const ids = new Set<string>();
    const groups = new Map<string, ExternalCashFlowImportItemDto[]>();
    for (const item of data.items) {
      if (!accounts.has(item.accountId) || ids.has(item.id)) {
        throw new BadRequestException(
          'Invalid external cash-flow account or duplicate id'
        );
      }
      ids.add(item.id);
      if (new Date(item.updatedAt) < new Date(item.createdAt)) {
        throw new BadRequestException('Invalid external cash-flow audit dates');
      }
      const isTransfer = item.type.startsWith('TRANSFER_');
      if (isTransfer !== Boolean(item.transferGroupId)) {
        throw new BadRequestException(
          'Invalid external cash-flow transfer grouping'
        );
      }
      if (item.transferGroupId) {
        const group = groups.get(item.transferGroupId) ?? [];
        group.push(item);
        groups.set(item.transferGroupId, group);
      }
    }
    for (const group of groups.values()) {
      const outgoing = group.find(({ type }) => type === 'TRANSFER_OUT');
      const incoming = group.find(({ type }) => type === 'TRANSFER_IN');
      if (
        group.length !== 2 ||
        !outgoing ||
        !incoming ||
        outgoing.accountId === incoming.accountId ||
        outgoing.date > incoming.date ||
        (outgoing.currency === incoming.currency &&
          !new Big(outgoing.amount).eq(incoming.amount))
      ) {
        throw new BadRequestException(
          'Invalid or incomplete external cash-flow transfer pair'
        );
      }
    }
    return data;
  }

  public async importSection({
    accountIdMapping,
    input,
    isDryRun,
    ownedAccountIds,
    sourceAccountIds,
    userId
  }: {
    accountIdMapping: Record<string, string>;
    input: ExternalCashFlowImportSectionDto;
    isDryRun: boolean;
    ownedAccountIds: string[];
    sourceAccountIds: string[];
    userId: string;
  }) {
    const data = this.validateImportSection(input, sourceAccountIds);
    const ownedAccounts = new Set(ownedAccountIds);
    const mapped = data.items.map((item) => {
      const accountId = accountIdMapping[item.accountId] ?? item.accountId;
      if (!ownedAccounts.has(accountId) && !isDryRun) {
        throw new BadRequestException('Invalid imported cash-flow account');
      }
      return {
        accountId,
        userId,
        amount: new Prisma.Decimal(item.amount),
        comment: item.comment ?? null,
        createdAt: new Date(item.createdAt),
        currency: item.currency,
        date: accountingDate(item.date),
        id: importUuid(userId, 'flow', item.id),
        source: item.source ?? null,
        transferGroupId: item.transferGroupId
          ? importUuid(userId, 'group', item.transferGroupId)
          : null,
        type: item.type,
        updatedAt: new Date(item.updatedAt)
      } satisfies Prisma.ExternalCashFlowUncheckedCreateInput;
    });
    if (isDryRun || !mapped.length) {
      return { created: mapped.length, skipped: 0, version: 1 as const };
    }

    const result = await this.prismaService.$transaction(
      async (tx) => {
        const ids = mapped.map(({ id }) => id);
        const groupIds = mapped
          .map(({ transferGroupId }) => transferGroupId)
          .filter((id): id is string => Boolean(id));
        const existing = await tx.externalCashFlow.findMany({
          where: {
            userId,
            OR: [{ id: { in: ids } }, { transferGroupId: { in: groupIds } }]
          }
        });
        const existingById = new Map(existing.map((flow) => [flow.id, flow]));
        for (const transferGroupId of new Set(groupIds)) {
          const importedGroup = mapped.filter(
            (flow) => flow.transferGroupId === transferGroupId
          );
          const existingGroup = existing.filter(
            (flow) => flow.transferGroupId === transferGroupId
          );
          if (
            existingGroup.length > 0 &&
            existingGroup.length !== importedGroup.length
          ) {
            throw new ConflictException(
              'External cash-flow import id or group collision'
            );
          }
        }
        for (const flow of existing) {
          const expected = mapped.find(({ id }) => id === flow.id);
          if (!expected || !this.sameImportedFlow(flow, expected)) {
            throw new ConflictException(
              'External cash-flow import id or group collision'
            );
          }
        }
        const toCreate = mapped.filter(({ id }) => !existingById.has(id));
        if (toCreate.length) {
          await tx.externalCashFlow.createMany({ data: toCreate });
        }
        return {
          created: toCreate.length,
          skipped: mapped.length - toCreate.length,
          version: 1 as const
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    if (result.created) {
      this.eventEmitter.emit(
        PortfolioChangedEvent.getName(),
        new PortfolioChangedEvent({ userId })
      );
    }
    return result;
  }

  private dateFilter(from?: string, to?: string) {
    return {
      gte: from ? accountingDate(from) : undefined,
      lte: to ? accountingDate(to) : undefined
    };
  }

  private sameImportedFlow(
    actual: ExternalCashFlow,
    expected: Prisma.ExternalCashFlowUncheckedCreateInput
  ) {
    return (
      actual.userId === expected.userId &&
      actual.accountId === expected.accountId &&
      actual.amount.equals(expected.amount as Prisma.Decimal) &&
      actual.comment === expected.comment &&
      actual.createdAt.getTime() === (expected.createdAt as Date).getTime() &&
      actual.currency === expected.currency &&
      actual.date.getTime() === (expected.date as Date).getTime() &&
      actual.source === expected.source &&
      actual.transferGroupId === expected.transferGroupId &&
      actual.type === expected.type &&
      actual.updatedAt.getTime() === (expected.updatedAt as Date).getTime()
    );
  }

  private serializeExport(flow: ExternalCashFlow): ExternalCashFlowExportItem {
    return {
      id: flow.id,
      accountId: flow.accountId,
      amount: flow.amount.toFixed(),
      comment: flow.comment,
      createdAt: flow.createdAt.toISOString(),
      currency: flow.currency,
      date: flow.date.toISOString().slice(0, 10),
      source: flow.source,
      transferGroupId: flow.transferGroupId,
      type: flow.type,
      updatedAt: flow.updatedAt.toISOString()
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
