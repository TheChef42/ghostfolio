import { DataSource, ExternalCashFlowType, Prisma, Type } from '@prisma/client';
import { Big } from 'big.js';

import { PerformanceScopeResolver } from '../performance-scope.resolver';
import { PortfolioValuationTimelineService } from '../portfolio-valuation-timeline.service';
import type { HistoricalValueResolver } from '../valuation-timeline.types';
import { TwrTimelineAdapter } from './twr-timeline.adapter';
import { TwrCalculator } from './twr.calculator';

describe('TWR with the Phase 4A golden timeline', () => {
  it('uses only external capital as flows and chains internal performance', async () => {
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

    const prepared = new TwrTimelineAdapter().fromTimeline(timeline);
    const result = new TwrCalculator().calculate(prepared);
    const Decimal = Big();
    Decimal.DP = 40;

    expect(prepared.points).toEqual([
      { date: '2023-12-31', externalFlow: '0', portfolioValue: '100' },
      { date: '2024-01-01', externalFlow: '50', portfolioValue: '150' },
      { date: '2024-01-02', externalFlow: '0', portfolioValue: '155' },
      { date: '2024-01-03', externalFlow: '-20', portfolioValue: '135' }
    ]);
    expect(
      new Decimal(result.periodReturn!).eq(
        new Decimal('155').div('150').minus(1)
      )
    ).toBe(true);
    expect(result.series.map(({ indexLevel }) => indexLevel)).toEqual([
      '1',
      '1',
      new Decimal('155').div('150').toString(),
      new Decimal('155').div('150').toString()
    ]);
  });
});
