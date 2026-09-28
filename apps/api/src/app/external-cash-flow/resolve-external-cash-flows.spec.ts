import { ConflictException } from '@nestjs/common';
import { ExternalCashFlow, Prisma } from '@prisma/client';
import { Big } from 'big.js';

import { resolveExternalCashFlows } from './resolve-external-cash-flows';

describe('scope-aware external cash flows', () => {
  const row = (data: Partial<ExternalCashFlow>): ExternalCashFlow => ({
    id: 'deposit',
    userId: 'owner',
    accountId: 'A',
    amount: new Prisma.Decimal('174200'),
    currency: 'DKK',
    date: new Date('2026-01-01Z'),
    type: 'DEPOSIT',
    transferGroupId: null,
    source: null,
    comment: null,
    createdAt: new Date('2026-01-01Z'),
    updatedAt: new Date('2026-01-01Z'),
    ...data
  });
  const pair = [
    row({ id: 'out', type: 'TRANSFER_OUT', transferGroupId: 'pair' }),
    row({
      id: 'in',
      accountId: 'B',
      type: 'TRANSFER_IN',
      transferGroupId: 'pair',
      date: new Date('2026-01-03Z')
    })
  ];
  const resolve = (
    accountIds: string[],
    flows = pair,
    from?: Date,
    to?: Date
  ) =>
    resolveExternalCashFlows({ flows, userId: 'owner', accountIds, from, to });

  it.each([
    [['A', 'B'], '0'],
    [['A'], '-174200'],
    [['B'], '174200'],
    [[], '0'],
    [['B', 'A', 'A'], '0']
  ] as [string[], string][])(
    'resolves account scope %j to %s',
    (scope, total) => {
      expect(
        resolve(scope)
          .reduce((sum, flow) => sum.plus(flow.amount), new Big(0))
          .toFixed()
      ).toBe(total);
    }
  );
  it('cancels a pair even when receipt is outside the measurement window', () => {
    expect(
      resolve(
        ['A', 'B'],
        pair,
        new Date('2026-01-01Z'),
        new Date('2026-01-02Z')
      )
    ).toEqual([]);
    expect(
      resolve(['A'], pair, new Date('2026-01-01Z'), new Date('2026-01-02Z'))[0]
        .amount
    ).toBe('-174200');
  });
  it('retains exact deposits/withdrawals and inclusive date bounds', () => {
    const flows = [
      row({ amount: new Prisma.Decimal('0.000000000000000001') }),
      row({
        id: 'withdraw',
        type: 'WITHDRAWAL',
        amount: new Prisma.Decimal('999999999999999999.999999999999999999')
      })
    ];
    expect(
      resolve(
        ['A'],
        flows,
        new Date('2026-01-01Z'),
        new Date('2026-01-01Z')
      ).map(({ amount }) => amount)
    ).toEqual([
      '0.000000000000000001',
      '-999999999999999999.999999999999999999'
    ]);
    expect(resolve(['A'], flows, new Date('2026-01-02Z'))).toEqual([]);
  });
  it('cancels cross-currency principals by identity and retains single-leg currency', () => {
    const flows = [
      pair[0],
      {
        ...pair[1],
        currency: 'EUR',
        amount: new Prisma.Decimal('23333.333333333333333333')
      }
    ];
    expect(resolve(['A', 'B'], flows)).toEqual([]);
    expect(resolve(['B'], flows)[0]).toMatchObject({
      currency: 'EUR',
      amount: '23333.333333333333333333'
    });
  });
  it.each([
    [pair[0]],
    [pair[0], pair[0]],
    [...pair, { ...pair[1], id: 'extra' }],
    [pair[0], { ...pair[1], userId: 'other' }],
    [pair[0], { ...pair[1], amount: new Prisma.Decimal(1) }],
    [pair[0], { ...pair[1], accountId: 'A' }],
    [pair[0], { ...pair[1], date: new Date('2025-01-01Z') }],
    [pair[0], { ...pair[1], type: 'DEPOSIT' as const }],
    [{ ...pair[0], transferGroupId: null }]
  ])(
    'rejects malformed pair %# without returning partial results',
    (...flows) => {
      expect(() => resolve(['A', 'B'], flows)).toThrow(ConflictException);
    }
  );
  it('never mixes owners even when the foreign account is out of scope', () => {
    expect(() =>
      resolve(['A'], [row({ userId: 'other', accountId: 'B' })])
    ).toThrow(ConflictException);
  });
});
