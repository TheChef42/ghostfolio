import { DataSource, ExternalCashFlowType, Prisma, Type } from '@prisma/client';
import { Big } from 'big.js';

import { PerformanceScopeResolver } from '../performance-scope.resolver';
import { PortfolioValuationTimelineService } from '../portfolio-valuation-timeline.service';
import type { HistoricalValueResolver } from '../valuation-timeline.types';
import type { PreparedBenchmarkTimeline } from './benchmark.types';
import { CashFlowMatchedBenchmarkSimulator } from './cash-flow-matched-benchmark.simulator';

describe('benchmark simulation with the Phase 4A golden timeline', () => {
  it('trades only normalized external capital and matches an independent result', async () => {
    const valuationService = new PortfolioValuationTimelineService(
      null as never,
      new PerformanceScopeResolver(),
      null as never
    );
    const resolver: HistoricalValueResolver = {
      resolveFx: async ({ date }) => ({
        requestedDate: date,
        sourceDate: date,
        stalenessDays: 0,
        value: '1'
      }),
      resolvePrice: async ({ date }) => ({
        requestedDate: date,
        sourceDate: date,
        stalenessDays: 0,
        value: '40'
      })
    };
    const activity = (
      id: string,
      type: Type,
      date: string,
      unitPrice: string
    ) => ({
      accountId: 'a',
      assetId: 'asset',
      currency: 'DKK',
      dataSource: DataSource.YAHOO,
      date: new Date(`${date}T12:00:00.000Z`),
      fee: '0',
      id,
      quantity: '1',
      symbol: 'TEST',
      type,
      unitPrice
    });
    const cashFlow = (
      id: string,
      type: ExternalCashFlowType,
      amount: string,
      date: string
    ) => ({
      accountId: 'a',
      amount: new Prisma.Decimal(amount),
      comment: null,
      createdAt: new Date(`${date}T00:00:00.000Z`),
      currency: 'DKK',
      date: new Date(`${date}T00:00:00.000Z`),
      id,
      source: null,
      transferGroupId: null,
      type,
      updatedAt: new Date(`${date}T00:00:00.000Z`),
      userId: 'user'
    });
    const timeline = await valuationService.buildTimeline({
      baseCurrency: 'DKK',
      from: '2024-01-01',
      inputs: {
        accounts: [{ currency: 'DKK', id: 'a' }],
        activities: [
          activity('opening-buy', Type.BUY, '2023-12-30', '40'),
          activity('range-buy', Type.BUY, '2024-01-01', '40'),
          activity('dividend', Type.DIVIDEND, '2024-01-02', '10'),
          activity('fee', Type.FEE, '2024-01-02', '5')
        ],
        balances: [
          {
            accountId: 'a',
            date: new Date('2023-12-31T00:00:00.000Z'),
            value: 60
          }
        ],
        externalCashFlows: [
          cashFlow('deposit', ExternalCashFlowType.DEPOSIT, '50', '2024-01-01'),
          cashFlow(
            'withdrawal',
            ExternalCashFlowType.WITHDRAWAL,
            '20',
            '2024-01-03'
          )
        ]
      },
      resolver,
      scope: { accountIds: ['a'], identity: 'a', type: 'WHOLE_PORTFOLIO' },
      to: '2024-01-03',
      userId: 'user'
    });
    const prices = ['10', '12', '8', '11'];
    const benchmarkTimeline: PreparedBenchmarkTimeline = {
      baseCurrency: 'DKK',
      benchmark: {
        basis: 'PRICE_ONLY',
        currency: 'DKK',
        dataSource: DataSource.YAHOO,
        id: 'benchmark',
        name: 'Synthetic index',
        symbol: 'IDX'
      },
      coverage: { reasons: [], status: 'COMPLETE' },
      points: timeline.timeline.map(({ date }, index) => ({
        date,
        fx: {
          requestedDate: date,
          sourceDate: date,
          stalenessDays: 0,
          value: '1'
        },
        nativePrice: {
          requestedDate: date,
          sourceDate: date,
          stalenessDays: 0,
          value: prices[index]
        },
        priceInBaseCurrency: prices[index]
      }))
    };

    const result = new CashFlowMatchedBenchmarkSimulator().calculate({
      benchmarkTimeline,
      timeline
    });

    expect(
      timeline.externalFlows.map(
        ({ amountInBaseCurrency }) => amountInBaseCurrency
      )
    ).toEqual(['50', '-20']);
    expect(result.flowSchedule).toHaveLength(2);
    // 100/10 + 50/12 - 20/11 = 815/66 units; at 11 the value is 815/6.
    const Decimal = Big();
    Decimal.DP = 40;
    expect(
      new Decimal(result.units!)
        .minus(new Decimal(815).div(66))
        .abs()
        .lt('1e-35')
    ).toBe(true);
    expect(
      new Decimal(result.benchmarkValue!)
        .minus(new Decimal(815).div(6))
        .abs()
        .lt('1e-35')
    ).toBe(true);
    expect(result.portfolioValue).toBe('135');
  });
});
