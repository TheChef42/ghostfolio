import { ExternalCashFlowType } from '@prisma/client';

import type {
  PortfolioValuationTimeline,
  ScopeExternalFlow,
  ValuationCoverageStatus
} from '../valuation-timeline.types';
import { ModifiedDietzCalculator } from './modified-dietz.calculator';

const calculator = new ModifiedDietzCalculator();

function flow(
  amountInBaseCurrency: string | null,
  date: string,
  accountId = 'a'
): ScopeExternalFlow {
  return {
    accountId,
    amountInBaseCurrency,
    currency: 'DKK',
    date,
    fx: null,
    signedAmount: amountInBaseCurrency ?? '0',
    transferGroupId: null,
    type: !amountInBaseCurrency?.startsWith('-')
      ? ExternalCashFlowType.DEPOSIT
      : ExternalCashFlowType.WITHDRAWAL
  };
}

function timeline({
  closing = '100',
  coverage = 'COMPLETE',
  externalFlows = [],
  from = '2024-01-01',
  opening = '100',
  openingDate = '2023-12-31',
  to = '2024-01-10'
}: {
  closing?: string | null;
  coverage?: ValuationCoverageStatus;
  externalFlows?: ScopeExternalFlow[];
  from?: string;
  opening?: string | null;
  openingDate?: string;
  to?: string;
} = {}): PortfolioValuationTimeline {
  const point = (date: string, kind: 'CLOSING' | 'OPENING') => ({
    cashValueInBaseCurrency: null,
    date,
    holdings: [],
    holdingsValueInBaseCurrency: null,
    kind,
    totalValueInBaseCurrency: kind === 'OPENING' ? opening : closing
  });

  return {
    accountingConvention: {
      activityTiming: 'END_OF_DAY',
      opening: 'CLOSE_BEFORE_FROM',
      timezone: 'UTC'
    },
    baseCurrency: 'DKK',
    closing: point(to, 'CLOSING'),
    coverage: {
      reasons:
        coverage === 'COMPLETE'
          ? []
          : [
              {
                code: 'MISSING_PRICE',
                message: 'Synthetic incomplete valuation'
              }
            ],
      status: coverage
    },
    externalFlows,
    interval: { from, openingDate, to },
    methodologyVersion: 'phase-4a-v1',
    opening: point(openingDate, 'OPENING'),
    reconciliations: [],
    scope: {
      accountIds: ['a'],
      identity: 'a',
      type: 'WHOLE_PORTFOLIO'
    },
    timeline: []
  };
}

describe('ModifiedDietzCalculator', () => {
  it.each([
    ['no move and no flow', timeline(), '0', '0'],
    [
      'deposit and no move',
      timeline({ closing: '150', externalFlows: [flow('50', '2024-01-05')] }),
      '0',
      '0'
    ],
    [
      'withdrawal and no move',
      timeline({ closing: '60', externalFlows: [flow('-40', '2024-01-05')] }),
      '0',
      '0'
    ],
    ['gain and no flow', timeline({ closing: '110' }), '10', '0.1']
  ])('calculates %s', (_name, input, absoluteResult, periodReturn) => {
    expect(calculator.calculate(input)).toEqual(
      expect.objectContaining({ absoluteResult, periodReturn, reason: null })
    );
  });

  it('weights a mid-period deposit independently', () => {
    const result = calculator.calculate(
      timeline({ closing: '165', externalFlows: [flow('50', '2024-01-05')] })
    );
    expect(result).toEqual(
      expect.objectContaining({
        absoluteResult: '15',
        effectiveCapital: '125',
        periodReturn: '0.12',
        weightedExternalFlow: '25'
      })
    );
  });

  it('weights a mid-period withdrawal independently', () => {
    const result = calculator.calculate(
      timeline({ closing: '72', externalFlows: [flow('-40', '2024-01-05')] })
    );
    expect(result).toEqual(
      expect.objectContaining({
        absoluteResult: '12',
        effectiveCapital: '80',
        periodReturn: '0.15',
        weightedExternalFlow: '-20'
      })
    );
  });

  it('weights multiple flows on different dates', () => {
    const result = calculator.calculate(
      timeline({
        closing: '143',
        externalFlows: [flow('50', '2024-01-03'), flow('-20', '2024-01-08')]
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        absoluteResult: '13',
        effectiveCapital: '131',
        periodReturn: '0.0992366412213740458015267175572519083969',
        totalExternalFlow: '30',
        weightedExternalFlow: '31'
      })
    );
  });

  it('aggregates same-date flows through the weighted sum', () => {
    const result = calculator.calculate(
      timeline({
        closing: '143',
        externalFlows: [flow('50', '2024-01-05'), flow('-20', '2024-01-05')]
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        effectiveCapital: '115',
        totalExternalFlow: '30',
        weightedExternalFlow: '15'
      })
    );
  });

  it.each([
    ['whole-portfolio internal transfer', []],
    ['cross-currency whole-scope transfer', []]
  ])(
    'leaves %s neutral after Phase 4A normalization',
    (_name, externalFlows) => {
      expect(
        calculator.calculate(timeline({ closing: '110', externalFlows }))
      ).toEqual(
        expect.objectContaining({ periodReturn: '0.1', totalExternalFlow: '0' })
      );
    }
  );

  it('includes a single-account transfer leg in effective capital', () => {
    const result = calculator.calculate(
      timeline({ closing: '72', externalFlows: [flow('-40', '2024-01-05')] })
    );
    expect(result.effectiveCapital).toBe('80');
  });

  it('gives a final-day flow zero remaining weight', () => {
    const result = calculator.calculate(
      timeline({ closing: '160', externalFlows: [flow('50', '2024-01-10')] })
    );
    expect(result).toEqual(
      expect.objectContaining({
        absoluteResult: '10',
        periodReturn: '0.1',
        weightedExternalFlow: '0'
      })
    );
  });

  it('gives a first displayed-day flow nine tenths remaining weight', () => {
    const result = calculator.calculate(
      timeline({ closing: '160', externalFlows: [flow('50', '2024-01-01')] })
    );
    expect(result).toEqual(
      expect.objectContaining({
        effectiveCapital: '145',
        periodReturn: '0.0689655172413793103448275862068965517241',
        weightedExternalFlow: '45'
      })
    );
  });

  it.each([
    [
      'opening value is zero',
      timeline({ opening: '0', closing: '0' }),
      'ZERO_EFFECTIVE_CAPITAL'
    ],
    [
      'effective capital is zero',
      timeline({
        closing: '-100',
        externalFlows: [flow('-200', '2024-01-05')]
      }),
      'ZERO_EFFECTIVE_CAPITAL'
    ],
    [
      'effective capital is negative',
      timeline({
        closing: '-200',
        externalFlows: [flow('-300', '2024-01-05')]
      }),
      'NEGATIVE_EFFECTIVE_CAPITAL'
    ],
    [
      'coverage is unavailable',
      timeline({ coverage: 'UNAVAILABLE' }),
      'INCOMPLETE_VALUATION_INPUT'
    ],
    [
      'coverage is incomplete',
      timeline({ coverage: 'INCOMPLETE' }),
      'INCOMPLETE_VALUATION_INPUT'
    ],
    [
      'opening value is missing',
      timeline({ opening: null }),
      'MISSING_OPENING_VALUE'
    ],
    [
      'closing value is missing',
      timeline({ closing: null }),
      'MISSING_CLOSING_VALUE'
    ],
    [
      'interval has zero length',
      timeline({
        from: '2024-01-01',
        openingDate: '2024-01-01',
        to: '2024-01-01'
      }),
      'ZERO_LENGTH_INTERVAL'
    ],
    [
      'converted flow value is missing',
      timeline({ externalFlows: [flow(null, '2024-01-05')] }),
      'INCOMPLETE_VALUATION_INPUT'
    ]
  ])('returns null when %s', (_name, input, reason) => {
    expect(calculator.calculate(input)).toEqual(
      expect.objectContaining({ periodReturn: null, reason })
    );
  });

  it('does not accumulate decimal flows with binary floating-point error', () => {
    const result = calculator.calculate(
      timeline({
        closing: '100.3',
        externalFlows: [flow('0.1', '2024-01-05'), flow('0.2', '2024-01-05')]
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        absoluteResult: '0',
        totalExternalFlow: '0.3',
        weightedExternalFlow: '0.15'
      })
    );
  });

  it('keeps very large values finite and deterministic', () => {
    const result = calculator.calculate(
      timeline({
        closing: '100000000000000000000000000000000000001',
        opening: '99999999999999999999999999999999999999'
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        absoluteResult: '2',
        periodReturn: '2e-38'
      })
    );
  });
});
