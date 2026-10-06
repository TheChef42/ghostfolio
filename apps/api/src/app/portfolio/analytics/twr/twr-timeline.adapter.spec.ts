import { ExternalCashFlowType } from '@prisma/client';

import type {
  PortfolioValuationTimeline,
  ScopeExternalFlow,
  ValuationCoverageStatus,
  ValuationPoint
} from '../valuation-timeline.types';
import { TwrTimelineAdapter } from './twr-timeline.adapter';

const adapter = new TwrTimelineAdapter();

function flow(amount: string | null, date: string): ScopeExternalFlow {
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

function valuationPoint(
  date: string,
  totalValueInBaseCurrency: string | null,
  kind: ValuationPoint['kind']
): ValuationPoint {
  return {
    cashValueInBaseCurrency: null,
    date,
    holdings: [],
    holdingsValueInBaseCurrency: null,
    kind,
    totalValueInBaseCurrency
  };
}

function timeline({
  coverage = 'COMPLETE',
  externalFlows = [],
  points = [
    valuationPoint('2023-12-31', '100', 'OPENING'),
    valuationPoint('2024-01-01', '150', 'DAILY'),
    valuationPoint('2024-01-02', '160', 'CLOSING')
  ]
}: {
  coverage?: ValuationCoverageStatus;
  externalFlows?: ScopeExternalFlow[];
  points?: ValuationPoint[];
} = {}): PortfolioValuationTimeline {
  return {
    accountingConvention: {
      activityTiming: 'END_OF_DAY',
      opening: 'CLOSE_BEFORE_FROM',
      timezone: 'UTC'
    },
    baseCurrency: 'DKK',
    closing: points.at(-1)!,
    coverage: {
      reasons:
        coverage === 'COMPLETE'
          ? []
          : [{ code: 'MISSING_PRICE', message: 'Synthetic coverage failure' }],
      status: coverage
    },
    externalFlows,
    interval: {
      from: '2024-01-01',
      openingDate: '2023-12-31',
      to: '2024-01-02'
    },
    methodologyVersion: 'phase-4a-v1',
    opening: points[0],
    openingCash: [],
    reconciliations: [],
    scope: { accountIds: ['a'], identity: 'a', type: 'WHOLE_PORTFOLIO' },
    timeline: points
  };
}

describe('TwrTimelineAdapter', () => {
  it('aggregates signed same-day flows with decimal arithmetic', () => {
    const result = adapter.fromTimeline(
      timeline({
        externalFlows: [flow('50.1', '2024-01-01'), flow('-0.1', '2024-01-01')]
      })
    );
    expect(result.points[1].externalFlow).toBe('50');
  });

  it('is deterministic when same-date flows are reordered', () => {
    const flows = [flow('50.1', '2024-01-01'), flow('-0.1', '2024-01-01')];
    expect(
      adapter.fromTimeline(timeline({ externalFlows: flows })).points
    ).toEqual(
      adapter.fromTimeline(timeline({ externalFlows: [...flows].reverse() }))
        .points
    );
  });

  it.each([
    ['whole-portfolio internal transfer', []],
    ['cross-currency whole-scope transfer', []]
  ])(
    'keeps %s neutral after Phase 4A normalization',
    (_name, externalFlows) => {
      expect(
        adapter.fromTimeline(timeline({ externalFlows })).points[1].externalFlow
      ).toBe('0');
    }
  );

  it('keeps a single-account transfer leg as an external scope flow', () => {
    expect(
      adapter.fromTimeline(
        timeline({ externalFlows: [flow('-40', '2024-01-01')] })
      ).points[1].externalFlow
    ).toBe('-40');
  });

  it('keeps TWR available when coverage contains only a reconciliation warning', () => {
    const value = timeline();
    value.coverage.reasons = [
      {
        code: 'CASH_RECONCILIATION_MISMATCH',
        message: 'Synthetic warning',
        severity: 'WARNING'
      }
    ];
    expect(adapter.fromTimeline(value)).toEqual(
      expect.objectContaining({ preparationReason: null })
    );
  });

  it.each([
    [
      timeline({
        points: [
          valuationPoint('2023-12-31', null, 'OPENING'),
          valuationPoint('2024-01-01', '1', 'DAILY'),
          valuationPoint('2024-01-02', '1', 'CLOSING')
        ]
      }),
      'MISSING_OPENING_VALUE'
    ],
    [
      timeline({
        points: [
          valuationPoint('2023-12-31', '1', 'OPENING'),
          valuationPoint('2024-01-01', '1', 'DAILY'),
          valuationPoint('2024-01-02', null, 'CLOSING')
        ]
      }),
      'MISSING_CLOSING_VALUE'
    ],
    [timeline({ coverage: 'INCOMPLETE' }), 'INCOMPLETE_VALUATION_INPUT'],
    [
      timeline({ externalFlows: [flow(null, '2024-01-01')] }),
      'MISSING_FLOW_VALUE'
    ],
    [
      timeline({
        points: [
          valuationPoint('2023-12-31', '1', 'OPENING'),
          valuationPoint('2024-01-02', '1', 'CLOSING')
        ]
      }),
      'INVALID_TIMELINE'
    ]
  ])('returns an explicit reason for invalid input', (value, reason) => {
    expect(adapter.fromTimeline(value)).toEqual(
      expect.objectContaining({ points: [], preparationReason: reason })
    );
  });
});
