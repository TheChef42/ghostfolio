import { Prisma } from '@prisma/client';

import {
  getEarliestEconomicRecord,
  resolveMaximumAccountHistoryStart
} from './account-history.helper';

describe('account history helper', () => {
  it('selects the earliest economic record deterministically', () => {
    expect(
      getEarliestEconomicRecord([
        { date: new Date('2025-06-02T00:00:00.000Z'), type: 'ACTIVITY' },
        {
          date: new Date('2025-06-01T00:00:00.000Z'),
          type: 'EXTERNAL_CASH_FLOW'
        }
      ])
    ).toEqual({
      date: new Date('2025-06-01T00:00:00.000Z'),
      type: 'EXTERNAL_CASH_FLOW'
    });
  });

  it('allows explicit inception to start MAX before the first transaction', () => {
    expect(
      resolveMaximumAccountHistoryStart({
        accounts: [
          {
            id: 'account',
            inceptionDate: new Date('2026-09-01T00:00:00.000Z')
          }
        ],
        activities: [
          {
            accountId: 'account',
            date: new Date('2026-09-10T00:00:00.000Z')
          }
        ],
        balances: [],
        externalCashFlows: [],
        includeUnassignedActivities: false,
        to: '2026-10-01'
      })
    ).toBe('2026-09-01');
  });

  it('preserves economic-record MAX behavior without inception', () => {
    expect(
      resolveMaximumAccountHistoryStart({
        accounts: [{ id: 'account', inceptionDate: null }],
        activities: [],
        balances: [],
        externalCashFlows: [
          {
            accountId: 'account',
            amount: new Prisma.Decimal('10'),
            date: new Date('2026-09-10T00:00:00.000Z'),
            transferGroupId: null
          }
        ],
        includeUnassignedActivities: false,
        to: '2026-10-01'
      })
    ).toBe('2026-09-10');
  });
});
