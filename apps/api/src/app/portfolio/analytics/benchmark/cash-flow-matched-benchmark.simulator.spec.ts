import { DataSource, ExternalCashFlowType } from '@prisma/client';
import { Big } from 'big.js';

import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import type { PreparedBenchmarkTimeline } from './benchmark.types';
import { CashFlowMatchedBenchmarkSimulator } from './cash-flow-matched-benchmark.simulator';

const dates = ['2023-12-31', '2024-01-01', '2024-01-02', '2024-01-03'];
const timeline = ({
  closing = '100',
  flows = [],
  opening = '100'
}: {
  closing?: string;
  flows?: [string, string][];
  opening?: string;
} = {}): PortfolioValuationTimeline =>
  ({
    accountingConvention: {
      activityTiming: 'END_OF_DAY',
      opening: 'CLOSE_BEFORE_FROM',
      timezone: 'UTC'
    },
    baseCurrency: 'DKK',
    closing: { totalValueInBaseCurrency: closing },
    coverage: { reasons: [], status: 'COMPLETE' },
    externalFlows: flows.map(([date, amount]) => ({
      accountId: 'a',
      amountInBaseCurrency: amount,
      currency: 'DKK',
      date,
      fx: null,
      signedAmount: amount,
      transferGroupId: null,
      type:
        Number(amount) >= 0
          ? ExternalCashFlowType.DEPOSIT
          : ExternalCashFlowType.WITHDRAWAL
    })),
    interval: {
      from: dates[1],
      openingDate: dates[0],
      to: dates.at(-1)
    },
    opening: { totalValueInBaseCurrency: opening },
    scope: { accountIds: ['a'], identity: 'a', type: 'WHOLE_PORTFOLIO' },
    timeline: dates.map((date, index) => ({
      date,
      totalValueInBaseCurrency: index === dates.length - 1 ? closing : opening
    }))
  }) as PortfolioValuationTimeline;

const benchmark = (prices: string[]): PreparedBenchmarkTimeline => ({
  baseCurrency: 'DKK',
  benchmark: {
    basis: 'PRICE_ONLY',
    currency: 'DKK',
    dataSource: DataSource.YAHOO,
    id: 'benchmark',
    name: 'Index',
    symbol: 'IDX'
  },
  coverage: { reasons: [], status: 'COMPLETE' },
  points: dates.map((date, index) => ({
    date,
    fx: { requestedDate: date, sourceDate: date, stalenessDays: 0, value: '1' },
    nativePrice: {
      requestedDate: date,
      sourceDate: index === 1 ? dates[0] : date,
      stalenessDays: index === 1 ? 1 : 0,
      value: prices[index]
    },
    priceInBaseCurrency: prices[index]
  }))
});

describe('CashFlowMatchedBenchmarkSimulator', () => {
  const simulator = new CashFlowMatchedBenchmarkSimulator();

  it.each([
    ['flat benchmark', ['10', '10', '10', '10'], [], '100'],
    ['10% benchmark gain', ['10', '10', '10', '11'], [], '110'],
    [
      'flat benchmark with deposit',
      ['10', '10', '10', '10'],
      [['2024-01-02', '50']],
      '150'
    ]
  ])('%s', (_name, prices, flows, expected) => {
    const input = timeline({ flows: flows as [string, string][] });
    const result = simulator.calculate({
      benchmarkTimeline: benchmark(prices as string[]),
      timeline: input
    });
    expect(result.benchmarkValue).toBe(expected);
  });

  it('buys fractional units before a later gain', () => {
    const input = timeline({ flows: [['2024-01-01', '50']] });
    const result = simulator.calculate({
      benchmarkTimeline: benchmark(['10', '10', '10', '12']),
      timeline: input
    });
    expect(result.units).toBe('15');
    expect(result.benchmarkValue).toBe('180');
  });

  it('sells units for withdrawals and aggregates multiple flows', () => {
    const input = timeline({
      flows: [
        ['2024-01-01', '50'],
        ['2024-01-02', '-20'],
        ['2024-01-02', '10']
      ]
    });
    const result = simulator.calculate({
      benchmarkTimeline: benchmark(['10', '10', '10', '10']),
      timeline: input
    });
    expect(result.units).toBe('14');
    expect(result.benchmarkValue).toBe('140');
  });

  it('allows a withdrawal exactly equal to simulation value', () => {
    const input = timeline({ flows: [['2024-01-03', '-100']] });
    const result = simulator.calculate({
      benchmarkTimeline: benchmark(['10', '10', '10', '10']),
      timeline: input
    });
    expect(result).toMatchObject({
      benchmarkValue: '0',
      relativeDifference: null,
      simulationStatus: 'AVAILABLE',
      units: '0'
    });
  });

  it('rejects a withdrawal greater than simulation value without leverage', () => {
    const input = timeline({ flows: [['2024-01-02', '-101']] });
    const result = simulator.calculate({
      benchmarkTimeline: benchmark(['10', '10', '10', '10']),
      timeline: input
    });
    expect(result).toMatchObject({
      benchmarkCoverage: {
        reasons: [
          expect.objectContaining({
            code: 'BENCHMARK_SIMULATION_EXHAUSTED'
          })
        ],
        status: 'INCOMPLETE'
      },
      benchmarkValue: null,
      reason: 'BENCHMARK_SIMULATION_EXHAUSTED',
      simulationStatus: 'EXHAUSTED',
      units: '10'
    });
  });

  it('keeps decimal precision for tiny and large fractional trades', () => {
    const input = timeline({
      flows: [
        ['2024-01-01', '0.000000001'],
        ['2024-01-02', '1000000000']
      ],
      opening: '0.000000001'
    });
    const result = simulator.calculate({
      benchmarkTimeline: benchmark(['3', '3', '3', '3']),
      timeline: input
    });
    expect(
      new Big(result.benchmarkValue!)
        .minus('1000000000.000000002')
        .abs()
        .lt('1e-30')
    ).toBe(true);
  });

  it('golden fixture independently matches units, value and differences', () => {
    const input = timeline({
      closing: '190',
      flows: [
        ['2024-01-01', '60'],
        ['2024-01-03', '-44']
      ]
    });
    const result = simulator.calculate({
      benchmarkTimeline: benchmark(['10', '12', '8', '11']),
      timeline: input
    });
    // 10 opening units + 5 purchased - 4 sold = 11; 11 * 11 = 121.
    expect(result).toMatchObject({
      benchmarkValue: '121',
      difference: '69',
      relativeDifference: '0.5702479338842975206611570247933884297521',
      units: '11'
    });
  });

  it('retains prior-close source dates for non-trading-date flows', () => {
    const result = simulator.calculate({
      benchmarkTimeline: benchmark(['10', '10', '10', '10']),
      timeline: timeline({ flows: [['2024-01-01', '50']] })
    });
    expect(result.series[1].priceSourceDate).toBe('2023-12-31');
  });

  it.each([
    ['whole-portfolio internal transfer', []],
    ['cross-currency internal transfer at whole scope', []],
    ['single-account transfer leg', [['2024-01-01', '25']]]
  ] as [string, [string, string][]][])(
    'uses only the Phase 4A normalized schedule for %s',
    (_name, flows) => {
      const result = simulator.calculate({
        benchmarkTimeline: benchmark(['10', '10', '10', '10']),
        timeline: timeline({ flows })
      });
      expect(result.benchmarkValue).toBe(flows.length ? '125' : '100');
    }
  );

  it.each(['MISSING_BENCHMARK_PRICE', 'MISSING_BENCHMARK_FX'] as const)(
    'returns explicit %s instead of falling back',
    (code) => {
      const prepared = benchmark(['10', '10', '10', '10']);
      prepared.coverage = {
        reasons: [{ code, message: code, severity: 'ERROR' }],
        status: 'INCOMPLETE'
      };
      const result = simulator.calculate({
        benchmarkTimeline: prepared,
        timeline: timeline()
      });
      expect(result.reason).toBe(code);
    }
  );
});
