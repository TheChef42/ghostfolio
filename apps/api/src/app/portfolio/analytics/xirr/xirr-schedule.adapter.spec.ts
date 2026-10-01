import { ExternalCashFlowType } from '@prisma/client';

import type {
  PortfolioValuationTimeline,
  ScopeExternalFlow,
  ValuationCoverageStatus
} from '../valuation-timeline.types';
import { XirrScheduleAdapter } from './xirr-schedule.adapter';

const adapter = new XirrScheduleAdapter();

function externalFlow(amount: string | null, date: string): ScopeExternalFlow {
  return {
    accountId: 'a',
    amountInBaseCurrency: amount,
    currency: 'DKK',
    date,
    fx: null,
    signedAmount: amount ?? '0',
    transferGroupId: null,
    type: ExternalCashFlowType.DEPOSIT
  };
}

function timeline({
  closing = '180',
  coverage = 'COMPLETE',
  externalFlows = [],
  opening = '100',
  openingDate = '2023-12-31',
  to = '2024-12-30'
}: {
  closing?: string | null;
  coverage?: ValuationCoverageStatus;
  externalFlows?: ScopeExternalFlow[];
  opening?: string | null;
  openingDate?: string;
  to?: string;
} = {}): PortfolioValuationTimeline {
  const point = (
    date: string,
    kind: 'CLOSING' | 'OPENING',
    value: string | null
  ) => ({
    cashValueInBaseCurrency: null,
    date,
    holdings: [],
    holdingsValueInBaseCurrency: null,
    kind,
    totalValueInBaseCurrency: value
  });
  return {
    accountingConvention: {
      activityTiming: 'END_OF_DAY',
      opening: 'CLOSE_BEFORE_FROM',
      timezone: 'UTC'
    },
    baseCurrency: 'DKK',
    closing: point(to, 'CLOSING', closing),
    coverage: {
      reasons:
        coverage === 'COMPLETE'
          ? []
          : [{ code: 'MISSING_PRICE', message: 'Synthetic coverage failure' }],
      status: coverage
    },
    externalFlows,
    interval: { from: '2024-01-01', openingDate, to },
    methodologyVersion: 'phase-4a-v1',
    opening: point(openingDate, 'OPENING', opening),
    openingCash: [],
    reconciliations: [],
    scope: { accountIds: ['a'], identity: 'a', type: 'WHOLE_PORTFOLIO' },
    timeline: []
  };
}

describe('XirrScheduleAdapter', () => {
  it('builds the investor-perspective opening, flow and closing schedule', () => {
    const result = adapter.fromTimeline(
      timeline({ externalFlows: [externalFlow('50', '2024-07-01')] })
    );
    expect(result.schedule).toEqual([
      { amount: '-100', date: '2023-12-31', sources: ['OPENING_VALUE'] },
      { amount: '-50', date: '2024-07-01', sources: ['EXTERNAL_FLOW'] },
      { amount: '180', date: '2024-12-30', sources: ['CLOSING_VALUE'] }
    ]);
  });

  it('reverses a portfolio withdrawal into a positive investor flow', () => {
    const result = adapter.fromTimeline(
      timeline({ externalFlows: [externalFlow('-40', '2024-07-01')] })
    );
    expect(result.schedule[1].amount).toBe('40');
  });

  it('merges same-date flows, removes zero dates and orders deterministically', () => {
    const flows = [
      externalFlow('20', '2024-08-01'),
      externalFlow('30', '2024-03-01'),
      externalFlow('-30', '2024-03-01'),
      externalFlow('10', '2024-08-01')
    ];
    const left = adapter.fromTimeline(timeline({ externalFlows: flows }));
    const right = adapter.fromTimeline(
      timeline({ externalFlows: [...flows].reverse() })
    );
    expect(left.schedule).toEqual(right.schedule);
    expect(left.schedule).toEqual([
      { amount: '-100', date: '2023-12-31', sources: ['OPENING_VALUE'] },
      { amount: '-30', date: '2024-08-01', sources: ['EXTERNAL_FLOW'] },
      { amount: '180', date: '2024-12-30', sources: ['CLOSING_VALUE'] }
    ]);
  });

  it('keeps whole-portfolio transfers neutral when Phase 4A supplies no flow', () => {
    expect(adapter.fromTimeline(timeline()).schedule).toHaveLength(2);
  });

  it('keeps a Phase 4A single-account transfer leg as a schedule flow', () => {
    expect(
      adapter.fromTimeline(
        timeline({ externalFlows: [externalFlow('-40', '2024-07-01')] })
      ).schedule[1]
    ).toEqual(
      expect.objectContaining({ amount: '40', sources: ['EXTERNAL_FLOW'] })
    );
  });

  it.each([
    [timeline({ opening: null }), 'MISSING_OPENING_VALUE'],
    [timeline({ closing: null }), 'MISSING_CLOSING_VALUE'],
    [timeline({ coverage: 'INCOMPLETE' }), 'INCOMPLETE_VALUATION_INPUT'],
    [timeline({ coverage: 'UNAVAILABLE' }), 'INCOMPLETE_VALUATION_INPUT'],
    [
      timeline({ externalFlows: [externalFlow(null, '2024-07-01')] }),
      'INCOMPLETE_VALUATION_INPUT'
    ],
    [timeline({ openingDate: '2024-01-01', to: '2024-01-01' }), 'ZERO_DURATION']
  ])(
    'returns a preparation reason for an invalid timeline',
    (value, reason) => {
      expect(adapter.fromTimeline(value)).toEqual(
        expect.objectContaining({ preparationReason: reason, schedule: [] })
      );
    }
  );
});
