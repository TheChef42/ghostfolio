import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';

import { DataSource, MarketDataState, Prisma, Type } from '@prisma/client';

import { HistoricalValuationResolverService } from './historical-valuation-resolver.service';
import { PerformanceScopeResolver } from './performance-scope.resolver';
import { PortfolioValuationTimelineService } from './portfolio-valuation-timeline.service';

const from = '2025-01-01';
const to = '2025-12-31';

function fixture() {
  const currencies = ['DKK', 'EUR', 'USD'];
  const accounts = Array.from({ length: 5 }, (_, index) => ({
    currency: currencies[index % currencies.length],
    id: `account-${index}`,
    userId: 'benchmark-user'
  }));
  const profiles = Array.from({ length: 20 }, (_, index) => ({
    currency: currencies[index % currencies.length],
    dataSource: DataSource.YAHOO,
    id: `asset-${index}`,
    symbol: `ASSET${index}`
  }));
  const orders = Array.from({ length: 200 }, (_, index) => {
    const profile = profiles[index % profiles.length];
    const account = accounts[index % accounts.length];
    const day = 1 + Math.floor(index / profiles.length);
    return {
      accountId: account.id,
      accountUserId: 'benchmark-user',
      comment: null,
      createdAt: new Date(),
      currency: profile.currency,
      date: new Date(`2025-01-${day.toString().padStart(2, '0')}T12:00:00Z`),
      fee: 0,
      id: `order-${index}`,
      quantity: 0.1,
      symbolProfileId: profile.id,
      tags: [],
      type: Type.BUY,
      unitPrice: 10,
      updatedAt: new Date(),
      userId: 'benchmark-user',
      SymbolProfile: profile
    };
  });
  const balances = accounts.map((account) => ({
    accountId: account.id,
    createdAt: new Date(),
    date: new Date('2024-12-31T00:00:00Z'),
    id: `balance-${account.id}`,
    updatedAt: new Date(),
    userId: 'benchmark-user',
    value: 1_000
  }));
  const externalCashFlows = Array.from({ length: 12 }, (_, index) => ({
    accountId: accounts[index % accounts.length].id,
    amount: new Prisma.Decimal(25),
    comment: null,
    createdAt: new Date(),
    currency: accounts[index % accounts.length].currency,
    date: new Date(
      `2025-${(index + 1).toString().padStart(2, '0')}-15T00:00:00Z`
    ),
    id: `flow-${index}`,
    source: null,
    transferGroupId: null,
    type: 'DEPOSIT' as const,
    updatedAt: new Date(),
    userId: 'benchmark-user'
  }));

  return { accounts, balances, externalCashFlows, orders };
}

async function runSyntheticAnalysis() {
  const data = fixture();
  const marketDataItems = jest.fn().mockImplementation(({ take, where }) => {
    if (take === 1) return Promise.resolve([]);
    const dates: Date[] = [];
    for (
      let date = new Date('2024-12-31T00:00:00Z');
      date <= new Date('2025-12-31T00:00:00Z');
      date = new Date(date.getTime() + 7 * 86_400_000)
    ) {
      dates.push(date);
    }
    return Promise.resolve(
      (where.OR as { dataSource: DataSource; symbol: string }[]).flatMap(
        ({ dataSource, symbol }, identifierIndex) =>
          dates.map((date, dateIndex) => ({
            createdAt: new Date(),
            dataSource,
            date,
            id: `market-${identifierIndex}-${dateIndex}`,
            isCarriedForward: false,
            marketPrice: symbol.startsWith('ASSET') ? 10 : 1,
            state: MarketDataState.CLOSE,
            symbol
          }))
      )
    );
  });
  const resolver = new HistoricalValuationResolverService(
    {
      getDataSourceForExchangeRates: () => DataSource.YAHOO
    } as DataProviderService,
    { marketDataItems } as unknown as MarketDataService
  );
  const prisma = {
    account: { findMany: jest.fn().mockResolvedValue(data.accounts) },
    accountBalance: {
      findMany: jest.fn().mockResolvedValue(data.balances)
    },
    assetProfileSplit: { findMany: jest.fn().mockResolvedValue([]) },
    externalCashFlow: {
      findMany: jest.fn().mockResolvedValue(data.externalCashFlows)
    },
    order: { findMany: jest.fn().mockResolvedValue(data.orders) }
  };
  const service = new PortfolioValuationTimelineService(
    resolver as never,
    new PerformanceScopeResolver(),
    prisma as never
  );
  const input = {
    baseCurrency: 'DKK',
    from,
    to,
    userId: 'benchmark-user'
  };
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  await Promise.all([
    service.getTimeline(input),
    service.getTimeline(input),
    service.getTimeline(input)
  ]);
  const elapsedMs = performance.now() - startedAt;

  return {
    dbQueryGroups:
      prisma.account.findMany.mock.calls.length +
      prisma.accountBalance.findMany.mock.calls.length +
      prisma.assetProfileSplit.findMany.mock.calls.length +
      prisma.externalCashFlow.findMany.mock.calls.length +
      prisma.order.findMany.mock.calls.length,
    elapsedMs,
    heapDelta: process.memoryUsage().heapUsed - heapBefore,
    marketDataQueries: marketDataItems.mock.calls.length,
    timelineBuilds: prisma.order.findMany.mock.calls.length
  };
}

describe('portfolio analytics performance fixture', () => {
  it('measures a representative concurrent Analysis load', async () => {
    await runSyntheticAnalysis();
    const results = [];
    for (let iteration = 0; iteration < 3; iteration++) {
      results.push(await runSyntheticAnalysis());
    }
    const average = (key: keyof (typeof results)[number]) =>
      results.reduce((sum, result) => sum + result[key], 0) / results.length;
    const measurement = {
      dbQueryGroups: average('dbQueryGroups'),
      elapsedMs: Number(average('elapsedMs').toFixed(2)),
      heapDelta: Math.round(average('heapDelta')),
      marketDataQueries: average('marketDataQueries'),
      timelineBuilds: average('timelineBuilds')
    };

    console.log(`ANALYTICS_PERFORMANCE ${JSON.stringify(measurement)}`);
    expect(measurement.timelineBuilds).toBe(1);
  }, 30_000);
});
