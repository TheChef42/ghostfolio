import { DataSource } from '@prisma/client';

import type { TwrResult } from '../twr/twr.types';
import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import type { PreparedBenchmarkTimeline } from './benchmark.types';
import { TwrBenchmarkComparator } from './twr-benchmark-comparator';

const timeline = (values = ['100', '110']): PortfolioValuationTimeline =>
  ({
    accountingConvention: {
      activityTiming: 'END_OF_DAY',
      opening: 'CLOSE_BEFORE_FROM',
      timezone: 'UTC'
    },
    baseCurrency: 'DKK',
    closing: { totalValueInBaseCurrency: values.at(-1) },
    coverage: { reasons: [], status: 'COMPLETE' },
    externalFlows: [],
    interval: {
      from: '2024-01-01',
      openingDate: '2023-12-31',
      to: '2024-01-01'
    },
    opening: { totalValueInBaseCurrency: values[0] },
    scope: { accountIds: ['a'], identity: 'a', type: 'WHOLE_PORTFOLIO' },
    timeline: values.map((value, index) => ({
      date: index ? '2024-01-01' : '2023-12-31',
      totalValueInBaseCurrency: value
    }))
  }) as PortfolioValuationTimeline;

const twr = (reason: TwrResult['reason'] = null): TwrResult =>
  ({
    periodReturn: reason ? null : '0.1',
    reason,
    series: [
      {
        date: '2023-12-31',
        indexLevel: '1',
        portfolioValue: '100'
      },
      { date: '2024-01-01', indexLevel: '1.1', portfolioValue: '110' }
    ]
  }) as TwrResult;

const benchmark = (
  prices = ['100', '110'],
  basis: NonNullable<
    PreparedBenchmarkTimeline['benchmark']
  >['basis'] = 'UNKNOWN'
): PreparedBenchmarkTimeline => ({
  baseCurrency: 'DKK',
  benchmark: {
    basis,
    currency: 'DKK',
    dataSource: DataSource.YAHOO,
    id: 'benchmark',
    name: 'Index',
    symbol: 'IDX'
  },
  coverage: { reasons: [], status: 'COMPLETE' },
  points: prices.map((value, index) => ({
    date: index ? '2024-01-01' : '2023-12-31',
    fx: {
      requestedDate: index ? '2024-01-01' : '2023-12-31',
      sourceDate: index ? '2024-01-01' : '2023-12-29',
      stalenessDays: index ? 0 : 2,
      value: '1'
    },
    nativePrice: {
      requestedDate: index ? '2024-01-01' : '2023-12-31',
      sourceDate: index ? '2024-01-01' : '2023-12-29',
      stalenessDays: index ? 0 : 2,
      value
    },
    priceInBaseCurrency: value
  }))
});

describe('TwrBenchmarkComparator', () => {
  const calculator = new TwrBenchmarkComparator();

  it.each([
    ['equal 10% returns', ['100', '110'], '0.1'],
    ['portfolio 10% versus benchmark 5%', ['100', '105'], '0.05']
  ])('%s', (_name, prices, expected) => {
    const result = calculator.calculate({
      benchmarkTimeline: benchmark(prices),
      timeline: timeline(),
      twr: twr()
    });
    expect(result.benchmarkPeriodReturn).toBe(expected);
    expect(result.portfolioPeriodReturn).toBe('0.1');
  });

  it('normalizes both indices to one and retains prior-close diagnostics', () => {
    const result = calculator.calculate({
      benchmarkTimeline: benchmark(),
      timeline: timeline(),
      twr: twr()
    });
    expect(result.series[0]).toMatchObject({
      benchmarkIndex: '1',
      portfolioIndex: '1',
      priceSourceDate: '2023-12-29',
      priceStalenessDays: 2
    });
  });

  it('uses the portfolio TWR index without applying a mid-period deposit', () => {
    const portfolioTimeline = timeline();
    portfolioTimeline.externalFlows = [
      { amountInBaseCurrency: '50', date: '2024-01-01' }
    ] as never;
    const result = calculator.calculate({
      benchmarkTimeline: benchmark(['100', '105']),
      timeline: portfolioTimeline,
      twr: twr()
    });
    expect(result).toMatchObject({
      benchmarkPeriodReturn: '0.05',
      portfolioPeriodReturn: '0.1'
    });
  });

  it.each(['PRICE_ONLY', 'TOTAL_RETURN'] as const)(
    'preserves declared %s basis',
    (basis) => {
      const result = calculator.calculate({
        benchmarkTimeline: benchmark(['100', '110'], basis),
        timeline: timeline(),
        twr: twr()
      });
      expect(result.benchmark?.basis).toBe(basis);
    }
  );

  it('does not fabricate continuity across an unfunded portfolio gap', () => {
    const result = calculator.calculate({
      benchmarkTimeline: benchmark(),
      timeline: timeline(),
      twr: twr('UNFUNDED_SEGMENT_BREAK')
    });
    expect(result).toMatchObject({
      benchmarkPeriodReturn: null,
      portfolioPeriodReturn: null,
      reason: 'UNFUNDED_SEGMENT_BREAK',
      series: []
    });
  });

  it.each(['MISSING_BENCHMARK_PRICE', 'MISSING_BENCHMARK_FX'] as const)(
    'returns explicit %s coverage failure',
    (code) => {
      const input = benchmark();
      input.coverage = {
        reasons: [{ code, message: code, severity: 'ERROR' }],
        status: 'INCOMPLETE'
      };
      const result = calculator.calculate({
        benchmarkTimeline: input,
        timeline: timeline(),
        twr: twr()
      });
      expect(result.reason).toBe(code);
      expect(result.series).toEqual([]);
    }
  );
});
