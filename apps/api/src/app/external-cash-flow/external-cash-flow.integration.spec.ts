import { AccountService } from '@ghostfolio/api/app/account/account.service';
import { PortfolioChangedEvent } from '@ghostfolio/api/events/portfolio-changed.event';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import {
  BadRequestException,
  ConflictException,
  NotFoundException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import {
  CreateExternalCashFlowDto,
  GetExternalCashFlowsDto
} from './external-cash-flow.dto';
import { ExternalCashFlowService } from './external-cash-flow.service';

// Explicitly opt in with a disposable local database; never use DATABASE_URL.
const testUrl = process.env.CASH_FLOW_TEST_DATABASE_URL;
const databaseTests = testUrl ? describe : describe.skip;

databaseTests('ExternalCashFlow PostgreSQL integration', () => {
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const accountA = randomUUID();
  const accountB = randomUUID();
  const foreignAccount = randomUUID();
  let prisma: PrismaService;
  let service: ExternalCashFlowService;
  const emitter = new EventEmitter2();
  const event = jest.fn();
  const ordinary = (
    type: 'DEPOSIT' | 'WITHDRAWAL' = 'DEPOSIT'
  ): CreateExternalCashFlowDto => ({
    accountId: accountA,
    amount: '123.456789012345678901',
    currency: 'EUR',
    date: '2026-01-01',
    type
  });
  const transfer = () => ({
    from: {
      accountId: accountA,
      amount: '174200',
      currency: 'DKK',
      date: '2026-01-01'
    },
    to: {
      accountId: accountB,
      amount: '174200',
      currency: 'DKK',
      date: '2026-01-03'
    }
  });

  beforeAll(async () => {
    const url = new URL(testUrl);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !url.pathname.startsWith('/phase1_')
    ) {
      throw new Error('Only a disposable local phase1_ database is allowed');
    }
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: testUrl }));
    await prisma.$connect();
    service = new ExternalCashFlowService(prisma, emitter);
    emitter.on(PortfolioChangedEvent.getName(), event);
    await prisma.user.createMany({
      data: [{ id: userId }, { id: otherUserId }]
    });
    await prisma.account.createMany({
      data: [
        { id: accountA, userId },
        { id: accountB, userId },
        { id: foreignAccount, userId: otherUserId }
      ]
    });
    // A real failure on the SECOND leg demonstrates database rollback, rather
    // than a mocked transaction that merely promises to be atomic.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION phase1_fail_second_leg() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD.type = 'TRANSFER_IN' AND OLD.source = 'rollback-delete' THEN RAISE EXCEPTION 'test delete failure'; END IF;
          RETURN OLD;
        END IF;
        IF NEW.type = 'TRANSFER_IN' AND NEW.source = 'rollback' THEN RAISE EXCEPTION 'test second-leg failure'; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER phase1_second_leg BEFORE INSERT OR UPDATE OR DELETE ON "ExternalCashFlow" FOR EACH ROW EXECUTE FUNCTION phase1_fail_second_leg()'
    );
  });

  beforeEach(async () => {
    await prisma.externalCashFlow.updateMany({
      where: { userId: { in: [userId, otherUserId] } },
      data: { source: null }
    });
    await prisma.externalCashFlow.deleteMany({
      where: { userId: { in: [userId, otherUserId] } }
    });
    event.mockClear();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS phase1_second_leg ON "ExternalCashFlow"'
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS phase1_fail_second_leg()'
      );
      await prisma.user.deleteMany({
        where: { id: { in: [userId, otherUserId] } }
      });
      await prisma.$disconnect();
    }
    emitter.removeAllListeners();
  });

  it.each(['DEPOSIT', 'WITHDRAWAL'] as const)(
    'supports owned %s CRUD without changing account balances',
    async (type) => {
      const before = await prisma.accountBalance.count();
      const created = await service.create(userId, ordinary(type));
      expect(created.amount.toFixed()).toBe(ordinary().amount);
      expect(created.date.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect((await service.get(userId, created.id)).type).toBe(type);
      const updated = await service.update(userId, created.id, {
        amount: '0.000000000000000001',
        comment: 'updated'
      });
      expect(updated.amount.toFixed()).toBe('0.000000000000000001');
      expect(updated.comment).toBe('updated');
      await service.delete(userId, created.id);
      await expect(service.get(userId, created.id)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(await prisma.accountBalance.count()).toBe(before);
      expect(event).toHaveBeenCalledTimes(3);
      expect(event.mock.calls[0][0].getUserId()).toBe(userId);
    }
  );

  it.each(['0', '-1', '0.0000000000000000001'])(
    'rejects invalid amount %s before persistence',
    async (amount) => {
      await expect(
        service.create(userId, { ...ordinary(), amount })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await prisma.externalCashFlow.count({ where: { userId } })).toBe(
        0
      );
      expect(event).not.toHaveBeenCalled();
    }
  );
  it('rejects unsupported currency and foreign accounts', async () => {
    await expect(
      service.create(userId, { ...ordinary(), currency: 'INVALID' })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(userId, { ...ordinary(), accountId: foreignAccount })
    ).rejects.toBeInstanceOf(NotFoundException);
    const created = await service.create(userId, ordinary());
    await expect(
      service.update(userId, created.id, { accountId: foreignAccount })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('conceals foreign records across read/update/delete/list', async () => {
    const flow = await service.create(otherUserId, {
      ...ordinary(),
      accountId: foreignAccount
    });
    await expect(service.get(userId, flow.id)).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(
      service.update(userId, flow.id, { amount: '2' })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete(userId, flow.id)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(
      (await service.list(userId, new GetExternalCashFlowsDto())).count
    ).toBe(0);
  });
  it('filters and paginates in a stable date/id order', async () => {
    await service.create(userId, ordinary());
    await service.create(userId, { ...ordinary(), date: '2026-01-02' });
    await service.create(userId, { ...ordinary(), accountId: accountB });
    const result = await service.list(userId, {
      ...new GetExternalCashFlowsDto(),
      accounts: [accountA],
      from: '2026-01-01',
      to: '2026-01-02',
      take: 1,
      skip: 1
    });
    expect(result.count).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].date.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    await expect(
      service.list(userId, {
        ...new GetExternalCashFlowsDto(),
        from: '2026-02-01',
        to: '2026-01-01'
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('creates, updates and deletes exactly one pair, preserving ids', async () => {
    const pair = await service.createTransfer(userId, transfer());
    expect(pair.items.map(({ type }) => type)).toEqual([
      'TRANSFER_OUT',
      'TRANSFER_IN'
    ]);
    expect(
      pair.items.every(
        ({ transferGroupId }) => transferGroupId === pair.transferGroupId
      )
    ).toBe(true);
    expect(event).toHaveBeenCalledTimes(1);
    const updated = await service.updateTransfer(userId, pair.transferGroupId, {
      from: { ...transfer().from, amount: '10' },
      to: { ...transfer().to, amount: '10' }
    });
    expect(updated.items.map(({ id }) => id)).toEqual(
      pair.items.map(({ id }) => id)
    );
    expect(updated.items.map(({ amount }) => amount.toFixed())).toEqual([
      '10',
      '10'
    ]);
    await service.deleteTransfer(userId, pair.transferGroupId);
    expect(await prisma.externalCashFlow.count({ where: { userId } })).toBe(0);
    expect(event).toHaveBeenCalledTimes(3);
  });
  it('rolls back creation if the incoming INSERT fails', async () => {
    await expect(
      service.createTransfer(userId, { ...transfer(), source: 'rollback' })
    ).rejects.toThrow();
    expect(await prisma.externalCashFlow.count({ where: { userId } })).toBe(0);
    expect(event).not.toHaveBeenCalled();
  });
  it('rolls back both updates if the incoming UPDATE fails', async () => {
    const pair = await service.createTransfer(userId, transfer());
    event.mockClear();
    await expect(
      service.updateTransfer(userId, pair.transferGroupId, {
        from: { ...transfer().from, amount: '1' },
        to: { ...transfer().to, amount: '1' },
        source: 'rollback'
      })
    ).rejects.toThrow();
    const rows = await prisma.externalCashFlow.findMany({ where: { userId } });
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        ({ amount, source }) => amount.toFixed() === '174200' && source === null
      )
    ).toBe(true);
    expect(event).not.toHaveBeenCalled();
  });
  it('rolls back both deletions if the incoming DELETE fails', async () => {
    const pair = await service.createTransfer(userId, {
      ...transfer(),
      source: 'rollback-delete'
    });
    event.mockClear();
    await expect(
      service.deleteTransfer(userId, pair.transferGroupId)
    ).rejects.toThrow();
    expect(await prisma.externalCashFlow.count({ where: { userId } })).toBe(2);
    expect(event).not.toHaveBeenCalled();
  });
  it('emits only after rows are committed and visible to another connection', async () => {
    const counts: Promise<number>[] = [];
    const listener = () =>
      counts.push(prisma.externalCashFlow.count({ where: { userId } }));
    emitter.on(PortfolioChangedEvent.getName(), listener);
    try {
      await service.createTransfer(userId, transfer());
      expect(await Promise.all(counts)).toEqual([2]);
    } finally {
      emitter.off(PortfolioChangedEvent.getName(), listener);
    }
  });
  it('rejects independent edits/deletions of either transfer leg', async () => {
    const pair = await service.createTransfer(userId, transfer());
    for (const { id } of pair.items) {
      await expect(
        service.update(userId, id, { amount: '1' })
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(service.delete(userId, id)).rejects.toBeInstanceOf(
        ConflictException
      );
    }
    expect(await prisma.externalCashFlow.count({ where: { userId } })).toBe(2);
  });
  it('rejects foreign/same accounts, inconsistent principals and reversed dates', async () => {
    await expect(
      service.createTransfer(userId, {
        ...transfer(),
        to: { ...transfer().to, accountId: foreignAccount }
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createTransfer(userId, {
        ...transfer(),
        to: { ...transfer().to, accountId: accountA }
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createTransfer(userId, {
        ...transfer(),
        to: { ...transfer().to, amount: '1' }
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createTransfer(userId, {
        ...transfer(),
        to: { ...transfer().to, date: '2025-01-01' }
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('does not allow another user to use an existing group id', async () => {
    const pair = await service.createTransfer(userId, transfer());
    await expect(
      service.updateTransfer(otherUserId, pair.transferGroupId, transfer())
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.deleteTransfer(otherUserId, pair.transferGroupId)
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.create(userId, {
        ...ordinary(),
        transferGroupId: pair.transferGroupId
      } as CreateExternalCashFlowDto)
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('loads counterpart outside date/account selection for scope resolution', async () => {
    await service.createTransfer(userId, transfer());
    const input = {
      ...new GetExternalCashFlowsDto(),
      from: '2026-01-01',
      to: '2026-01-01'
    };
    expect(
      await service.resolveForScope(userId, {
        ...input,
        accounts: [accountA, accountB]
      })
    ).toEqual([]);
    expect(
      (
        await service.resolveForScope(userId, {
          ...input,
          accounts: [accountA]
        })
      )[0].amount
    ).toBe('-174200');
    expect(
      (
        await service.resolveForScope(userId, {
          ...new GetExternalCashFlowsDto(),
          accounts: [accountB]
        })
      )[0].amount
    ).toBe('174200');
  });
  it('stores cross-currency legs without fabricating an exchange rate', async () => {
    await service.createTransfer(userId, {
      ...transfer(),
      to: {
        ...transfer().to,
        currency: 'EUR',
        amount: '23333.333333333333333333'
      }
    });
    expect(
      await service.resolveForScope(userId, {
        ...new GetExternalCashFlowsDto(),
        accounts: [accountA, accountB]
      })
    ).toEqual([]);
    expect(
      (
        await service.resolveForScope(userId, {
          ...new GetExternalCashFlowsDto(),
          accounts: [accountB]
        })
      )[0]
    ).toMatchObject({ currency: 'EUR', amount: '23333.333333333333333333' });
  });
  it('enforces positive magnitudes and ownership at the database boundary', async () => {
    const data = {
      userId,
      accountId: accountA,
      date: new Date(),
      currency: 'EUR',
      type: 'DEPOSIT' as const,
      amount: new Prisma.Decimal(0)
    };
    await expect(prisma.externalCashFlow.create({ data })).rejects.toThrow();
    await expect(
      prisma.externalCashFlow.create({
        data: { ...data, amount: new Prisma.Decimal('NaN') }
      })
    ).rejects.toThrow();
    await expect(
      prisma.externalCashFlow.create({
        data: {
          ...data,
          amount: new Prisma.Decimal(1),
          accountId: foreignAccount
        }
      })
    ).rejects.toThrow();
  });
  it('enforces unique legs and reports incomplete groups deterministically', async () => {
    const pair = await service.createTransfer(userId, transfer());
    const leg = { ...pair.items[0], id: randomUUID() };
    await expect(
      prisma.externalCashFlow.create({ data: leg })
    ).rejects.toThrow();
    await prisma.externalCashFlow.delete({ where: { id: pair.items[1].id } });
    await expect(
      service.updateTransfer(userId, pair.transferGroupId, transfer())
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.deleteTransfer(userId, pair.transferGroupId)
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.resolveForScope(userId, {
        ...new GetExternalCashFlowsDto(),
        accounts: [accountA]
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('blocks AccountService deletion with financial history using HTTP 409', async () => {
    await service.create(userId, ordinary());
    const accounts = new AccountService(
      undefined,
      undefined,
      emitter,
      undefined,
      prisma,
      undefined
    );
    await expect(
      accounts.deleteAccount({ id_userId: { id: accountA, userId } })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      await prisma.account.count({ where: { id: accountA, userId } })
    ).toBe(1);
  });
  it('preserves user-erasure cascades with the deferred account foreign key', async () => {
    const temporaryUser = await prisma.user.create({ data: {} });
    const account = await prisma.account.create({
      data: { userId: temporaryUser.id }
    });
    await service.create(temporaryUser.id, {
      ...ordinary(),
      accountId: account.id
    });
    await prisma.user.delete({ where: { id: temporaryUser.id } });
    expect(
      await prisma.externalCashFlow.count({
        where: { userId: temporaryUser.id }
      })
    ).toBe(0);
  });
  it('concurrent pair updates either succeed coherently or return a conflict', async () => {
    const pair = await service.createTransfer(userId, transfer());
    const results = await Promise.allSettled(
      ['1', '2'].map((amount) =>
        service.updateTransfer(userId, pair.transferGroupId, {
          from: { ...transfer().from, amount },
          to: { ...transfer().to, amount }
        })
      )
    );
    for (const result of results) {
      if (result.status === 'rejected')
        expect(result.reason).toBeInstanceOf(ConflictException);
    }
    const rows = await prisma.externalCashFlow.findMany({
      where: { userId, transferGroupId: pair.transferGroupId }
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].amount.equals(rows[1].amount)).toBe(true);
  });
});
