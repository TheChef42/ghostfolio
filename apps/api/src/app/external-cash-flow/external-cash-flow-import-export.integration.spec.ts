import { PortfolioChangedEvent } from '@ghostfolio/api/events/portfolio-changed.event';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import {
  ExternalCashFlowImportItemDto,
  ExternalCashFlowImportSectionDto
} from './external-cash-flow-import.dto';
import { ExternalCashFlowService } from './external-cash-flow.service';

const testUrl = process.env.CASH_FLOW_TEST_DATABASE_URL;
const databaseTests = testUrl ? describe : describe.skip;

databaseTests('ExternalCashFlow import/export PostgreSQL integration', () => {
  const sourceUserId = randomUUID();
  const targetUserId = randomUUID();
  const sourceA = randomUUID();
  const sourceB = randomUUID();
  const targetA = randomUUID();
  const targetB = randomUUID();
  const accountMapping = { [sourceA]: targetA, [sourceB]: targetB };
  const sourceAccountIds = [sourceA, sourceB];
  const targetAccountIds = [targetA, targetB];
  const createdAt = '2025-12-31T22:01:02.003Z';
  const updatedAt = '2026-01-04T05:06:07.008Z';
  let prisma: PrismaService;
  let service: ExternalCashFlowService;
  const emitter = new EventEmitter2();
  const event = jest.fn();

  const item = (
    overrides: Partial<ExternalCashFlowImportItemDto> = {}
  ): ExternalCashFlowImportItemDto => ({
    id: randomUUID(),
    accountId: sourceA,
    amount: '123.456789012345678901',
    comment: 'exact comment',
    createdAt,
    currency: 'EUR',
    date: '2026-01-01',
    source: 'phase-2a-test',
    transferGroupId: null,
    type: 'DEPOSIT',
    updatedAt,
    ...overrides
  });
  const section = (
    items: ExternalCashFlowImportItemDto[],
    overrides: Partial<ExternalCashFlowImportSectionDto> = {}
  ): ExternalCashFlowImportSectionDto => ({ version: 1, items, ...overrides });

  beforeAll(async () => {
    const url = new URL(testUrl);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !url.pathname.startsWith('/phase2a_')
    ) {
      throw new Error('Only a disposable local phase2a_ database is allowed');
    }
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: testUrl }));
    await prisma.$connect();
    service = new ExternalCashFlowService(prisma, emitter);
    emitter.on(PortfolioChangedEvent.getName(), event);
    await prisma.user.createMany({
      data: [{ id: sourceUserId }, { id: targetUserId }]
    });
    await prisma.account.createMany({
      data: [
        { id: sourceA, userId: sourceUserId, name: 'Flow only A' },
        { id: sourceB, userId: sourceUserId, name: 'Flow only B' },
        { id: targetA, userId: targetUserId, name: 'Imported A' },
        { id: targetB, userId: targetUserId, name: 'Imported B' }
      ]
    });
    await prisma.$executeRawUnsafe(`CREATE FUNCTION phase2a_fail_incoming() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'TRANSFER_IN' AND NEW.source = 'fail-incoming' THEN RAISE EXCEPTION 'test second-leg failure'; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER phase2a_fail_incoming BEFORE INSERT ON "ExternalCashFlow" FOR EACH ROW EXECUTE FUNCTION phase2a_fail_incoming()'
    );
  });

  beforeEach(async () => {
    await prisma.externalCashFlow.deleteMany({
      where: { userId: { in: [sourceUserId, targetUserId] } }
    });
    event.mockClear();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS phase2a_fail_incoming ON "ExternalCashFlow"'
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS phase2a_fail_incoming()'
      );
      await prisma.user.deleteMany({
        where: { id: { in: [sourceUserId, targetUserId] } }
      });
      await prisma.$disconnect();
    }
    emitter.removeAllListeners();
  });

  it('round-trips deposits and withdrawals with exact decimals and audit data', async () => {
    await prisma.externalCashFlow.createMany({
      data: [
        {
          id: randomUUID(),
          accountId: sourceA,
          userId: sourceUserId,
          amount: new Prisma.Decimal('999999999999999999.123456789012345678'),
          comment: 'deposit comment',
          createdAt: new Date(createdAt),
          currency: 'EUR',
          date: new Date('2026-01-01T00:00:00.000Z'),
          source: 'nordnet',
          transferGroupId: null,
          type: 'DEPOSIT',
          updatedAt: new Date(updatedAt)
        },
        {
          id: randomUUID(),
          accountId: sourceB,
          userId: sourceUserId,
          amount: new Prisma.Decimal('0.000000000000000001'),
          comment: null,
          createdAt: new Date(createdAt),
          currency: 'DKK',
          date: new Date('2026-01-02T00:00:00.000Z'),
          source: null,
          transferGroupId: null,
          type: 'WITHDRAWAL',
          updatedAt: new Date(updatedAt)
        }
      ]
    });
    const exported = await service.exportSection({
      accountIds: sourceAccountIds,
      userId: sourceUserId
    });
    const result = await service.importSection({
      accountIdMapping: accountMapping,
      input: exported,
      isDryRun: false,
      ownedAccountIds: targetAccountIds,
      sourceAccountIds,
      userId: targetUserId
    });
    expect(result).toEqual({ created: 2, skipped: 0, version: 1 });
    const reexported = await service.exportSection({
      accountIds: targetAccountIds,
      userId: targetUserId
    });
    const normalize = (
      flow: (typeof reexported.items)[number],
      mapAccount = false
    ) => {
      const result: Partial<typeof flow> = {
        ...flow,
        accountId: mapAccount
          ? flow.accountId === targetA
            ? sourceA
            : flow.accountId === targetB
              ? sourceB
              : flow.accountId
          : flow.accountId
      };
      delete result.id;
      return result;
    };
    expect(reexported.items.map((flow) => normalize(flow, true))).toEqual(
      exported.items.map((flow) => normalize(flow))
    );
    expect(event).toHaveBeenCalledTimes(1);
  });

  it('round-trips same- and cross-currency pairs with remapped groups', async () => {
    const sameGroup = randomUUID();
    const crossGroup = randomUUID();
    const exported = section([
      item({
        accountId: sourceA,
        amount: '174200',
        currency: 'DKK',
        transferGroupId: sameGroup,
        type: 'TRANSFER_OUT'
      }),
      item({
        accountId: sourceB,
        amount: '174200',
        currency: 'DKK',
        date: '2026-01-03',
        transferGroupId: sameGroup,
        type: 'TRANSFER_IN'
      }),
      item({
        accountId: sourceA,
        amount: '100.000000000000000001',
        currency: 'EUR',
        date: '2026-02-01',
        transferGroupId: crossGroup,
        type: 'TRANSFER_OUT'
      }),
      item({
        accountId: sourceB,
        amount: '745.123456789012345678',
        currency: 'DKK',
        date: '2026-02-02',
        transferGroupId: crossGroup,
        type: 'TRANSFER_IN'
      })
    ]);
    await service.importSection({
      accountIdMapping: accountMapping,
      input: exported,
      isDryRun: false,
      ownedAccountIds: targetAccountIds,
      sourceAccountIds,
      userId: targetUserId
    });
    const imported = await service.exportSection({
      accountIds: targetAccountIds,
      userId: targetUserId
    });
    const groups = imported.items.reduce<Record<string, typeof imported.items>>(
      (result, flow) => {
        (result[flow.transferGroupId] ??= []).push(flow);
        return result;
      },
      {}
    );
    expect(Object.keys(groups)).toHaveLength(2);
    expect(Object.keys(groups)).not.toEqual(
      expect.arrayContaining([sameGroup, crossGroup])
    );
    expect(
      Object.values(groups).map((pair) =>
        pair.map(({ amount, currency, type }) => ({ amount, currency, type }))
      )
    ).toEqual([
      [
        { amount: '174200', currency: 'DKK', type: 'TRANSFER_OUT' },
        { amount: '174200', currency: 'DKK', type: 'TRANSFER_IN' }
      ],
      [
        {
          amount: '100.000000000000000001',
          currency: 'EUR',
          type: 'TRANSFER_OUT'
        },
        {
          amount: '745.123456789012345678',
          currency: 'DKK',
          type: 'TRANSFER_IN'
        }
      ]
    ]);
  });

  it('makes exact retries no-ops and rejects colliding changed content', async () => {
    const exported = section([item()]);
    const first = await service.importSection({
      accountIdMapping: accountMapping,
      input: exported,
      isDryRun: false,
      ownedAccountIds: targetAccountIds,
      sourceAccountIds,
      userId: targetUserId
    });
    const retry = await service.importSection({
      accountIdMapping: accountMapping,
      input: exported,
      isDryRun: false,
      ownedAccountIds: targetAccountIds,
      sourceAccountIds,
      userId: targetUserId
    });
    expect(first.created).toBe(1);
    expect(retry).toEqual({ created: 0, skipped: 1, version: 1 });
    await expect(
      service.importSection({
        accountIdMapping: accountMapping,
        input: section([{ ...exported.items[0], amount: '124' }]),
        isDryRun: false,
        ownedAccountIds: targetAccountIds,
        sourceAccountIds,
        userId: targetUserId
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      await prisma.externalCashFlow.count({ where: { userId: targetUserId } })
    ).toBe(1);
  });

  it('rejects incomplete, malformed, duplicate and ownership-injecting sections before writes', async () => {
    const group = randomUUID();
    const outgoing = item({ transferGroupId: group, type: 'TRANSFER_OUT' });
    const malformedCases = [
      section([outgoing]),
      section([
        outgoing,
        item({
          accountId: sourceB,
          amount: '999',
          transferGroupId: group,
          type: 'TRANSFER_IN'
        })
      ]),
      section([outgoing, { ...outgoing }]),
      section([item({ accountId: randomUUID() })]),
      section([item() as ExternalCashFlowImportItemDto], {
        incompleteTransferGroups: [
          {
            selectedFlowIds: [outgoing.id],
            reason: 'COUNTERPART_OUTSIDE_EXPORT_SCOPE',
            transferGroupId: group
          }
        ]
      }),
      section([
        { ...item(), userId: sourceUserId } as ExternalCashFlowImportItemDto
      ])
    ];
    for (const malformed of malformedCases) {
      expect(() =>
        service.validateImportSection(malformed, sourceAccountIds)
      ).toThrow(BadRequestException);
    }
    expect(
      await prisma.externalCashFlow.count({ where: { userId: targetUserId } })
    ).toBe(0);
  });

  it('reports and omits a transfer whose counterpart is outside a filtered export', async () => {
    const group = randomUUID();
    await prisma.externalCashFlow.createMany({
      data: [
        {
          id: randomUUID(),
          accountId: sourceA,
          userId: sourceUserId,
          amount: 10,
          currency: 'EUR',
          date: new Date('2026-01-01T00:00:00.000Z'),
          transferGroupId: group,
          type: 'TRANSFER_OUT'
        },
        {
          id: randomUUID(),
          accountId: sourceB,
          userId: sourceUserId,
          amount: 10,
          currency: 'EUR',
          date: new Date('2026-01-03T00:00:00.000Z'),
          transferGroupId: group,
          type: 'TRANSFER_IN'
        }
      ]
    });
    const exported = await service.exportSection({
      accountIds: sourceAccountIds,
      endDate: new Date('2026-01-01T00:00:00.000Z'),
      userId: sourceUserId
    });
    expect(exported.items).toEqual([]);
    expect(exported.incompleteTransferGroups).toEqual([
      expect.objectContaining({
        reason: 'COUNTERPART_OUTSIDE_EXPORT_SCOPE',
        transferGroupId: group
      })
    ]);
    expect(() =>
      service.validateImportSection(exported, sourceAccountIds)
    ).toThrow(BadRequestException);
  });

  it('rolls back the entire section when the incoming transfer leg fails', async () => {
    const group = randomUUID();
    const exported = section([
      item({
        source: 'fail-incoming',
        transferGroupId: group,
        type: 'TRANSFER_OUT'
      }),
      item({
        accountId: sourceB,
        source: 'fail-incoming',
        transferGroupId: group,
        type: 'TRANSFER_IN'
      })
    ]);
    await expect(
      service.importSection({
        accountIdMapping: accountMapping,
        input: exported,
        isDryRun: false,
        ownedAccountIds: targetAccountIds,
        sourceAccountIds,
        userId: targetUserId
      })
    ).rejects.toThrow();
    expect(
      await prisma.externalCashFlow.count({ where: { userId: targetUserId } })
    ).toBe(0);
    expect(event).not.toHaveBeenCalled();
  });
});
