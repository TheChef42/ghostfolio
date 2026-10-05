import { PortfolioChangedEvent } from '@ghostfolio/api/events/portfolio-changed.event';

import { ModifiedDietzAnalyticsService } from './modified-dietz/modified-dietz-analytics.service';
import { PerformanceScopeResolver } from './performance-scope.resolver';
import { PortfolioValuationTimelineService } from './portfolio-valuation-timeline.service';
import { TwrAnalyticsService } from './twr/twr-analytics.service';
import { XirrAnalyticsService } from './xirr/xirr-analytics.service';

const request = {
  accountIds: ['account-a'],
  baseCurrency: 'DKK',
  from: '2025-01-01',
  to: '2025-01-02',
  userId: 'user-a'
};

function context() {
  const marketDataRevision = { value: 0 };
  const accounts = [
    { currency: 'DKK', id: 'account-a', userId: 'user-a' },
    { currency: 'DKK', id: 'account-b', userId: 'user-a' }
  ];
  const prisma = {
    account: { findMany: jest.fn().mockResolvedValue(accounts) },
    accountBalance: {
      findMany: jest.fn().mockResolvedValue([
        {
          accountId: 'account-a',
          date: new Date('2024-12-31T00:00:00Z'),
          value: 100
        },
        {
          accountId: 'account-b',
          date: new Date('2024-12-31T00:00:00Z'),
          value: 100
        }
      ])
    },
    assetProfileSplit: { findMany: jest.fn().mockResolvedValue([]) },
    externalCashFlow: { findMany: jest.fn().mockResolvedValue([]) },
    order: { findMany: jest.fn().mockResolvedValue([]) }
  };
  const timeline = new PortfolioValuationTimelineService(
    {
      getRevision: () => marketDataRevision.value,
      resolveFx: jest.fn(),
      resolvePrice: jest.fn()
    } as never,
    new PerformanceScopeResolver(),
    prisma as never
  );
  return { marketDataRevision, prisma, timeline };
}

describe('portfolio analytics context reuse', () => {
  it('rejects an invalid interval before it can enter the cache', async () => {
    const { prisma, timeline } = context();

    await expect(
      timeline.getTimeline({ ...request, from: 'not-a-date' })
    ).rejects.toThrow('The resolved analytics range is invalid');
    await timeline.getTimeline(request);

    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
  });

  it('resolves MAX from the first scoped economic record', async () => {
    const { timeline } = context();

    const result = await timeline.getTimeline({ ...request, from: null });

    expect(result.interval).toEqual({
      from: '2025-01-01',
      openingDate: '2024-12-31',
      to: '2025-01-02'
    });
  });

  it('starts account MAX at explicit inception before its first transaction', async () => {
    const { prisma, timeline } = context();
    prisma.account.findMany.mockResolvedValue([
      {
        currency: 'DKK',
        id: 'account-a',
        inceptionDate: new Date('2024-06-01T00:00:00.000Z'),
        userId: 'user-a'
      }
    ]);

    const result = await timeline.getTimeline({ ...request, from: null });

    expect(result.interval.from).toBe('2024-06-01');
  });

  it('reuses one timeline for concurrent TWR, XIRR and Modified Dietz', async () => {
    const { prisma, timeline } = context();
    const twr = new TwrAnalyticsService(
      { calculate: jest.fn().mockReturnValue({}) } as never,
      { fromTimeline: jest.fn().mockReturnValue({}) } as never,
      timeline
    );
    const xirr = new XirrAnalyticsService(
      { calculate: jest.fn().mockReturnValue({}) } as never,
      { fromTimeline: jest.fn().mockReturnValue({}) } as never,
      timeline
    );
    const dietz = new ModifiedDietzAnalyticsService(
      { calculate: jest.fn().mockReturnValue({}) } as never,
      timeline
    );

    await Promise.all([
      twr.getPerformance(request),
      xirr.getPerformance(request),
      dietz.getPerformance(request)
    ]);

    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent identical requests and reuses the completed result', async () => {
    const { prisma, timeline } = context();
    const [first, second] = await Promise.all([
      timeline.getTimeline(request),
      timeline.getTimeline(request)
    ]);
    const warm = await timeline.getTimeline(request);

    expect(first).toBe(second);
    expect(warm).toBe(first);
    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
  });

  it('removes failed in-flight work so a later request can retry', async () => {
    const { prisma, timeline } = context();
    prisma.order.findMany
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce([]);

    await expect(
      Promise.all([
        timeline.getTimeline(request),
        timeline.getTimeline(request)
      ])
    ).rejects.toThrow('temporary failure');
    await expect(timeline.getTimeline(request)).resolves.toBeDefined();
    expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
  });

  it('never shares cached or in-flight work between users', async () => {
    const { prisma, timeline } = context();
    await Promise.all([
      timeline.getTimeline(request),
      timeline.getTimeline({ ...request, userId: 'user-b' })
    ]);
    expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
  });

  it('canonicalizes equivalent account order and duplicates', async () => {
    const { prisma, timeline } = context();
    await Promise.all([
      timeline.getTimeline({
        ...request,
        accountIds: ['account-a', 'account-b']
      }),
      timeline.getTimeline({
        ...request,
        accountIds: ['account-b', 'account-a', 'account-b']
      })
    ]);
    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps benchmark identity out of the portfolio timeline identity', async () => {
    const { prisma, timeline } = context();
    await Promise.all([
      timeline.getTimeline({ ...request, benchmark: 'first' } as never),
      timeline.getTimeline({ ...request, benchmark: 'second' } as never)
    ]);
    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['date range', { to: '2025-01-03' }],
    ['base currency', { baseCurrency: 'EUR' }]
  ])('isolates a different %s', async (_label, difference) => {
    const { prisma, timeline } = context();
    await Promise.all([
      timeline.getTimeline(request),
      timeline.getTimeline({ ...request, ...difference })
    ]);
    expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
  });

  it.each(['activity', 'external cash flow', 'balance'])(
    'invalidates after a relevant %s mutation event',
    async () => {
      const { prisma, timeline } = context();
      await timeline.getTimeline(request);
      timeline.handlePortfolioChanged(
        new PortfolioChangedEvent({ userId: request.userId })
      );
      await timeline.getTimeline(request);
      expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
    }
  );

  it('invalidates cached and in-flight timelines after an inception edit', async () => {
    const { prisma, timeline } = context();
    await timeline.getTimeline(request);
    timeline.handlePortfolioChanged(
      new PortfolioChangedEvent({ userId: request.userId })
    );
    await timeline.getTimeline(request);
    expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
  });

  it('invalidates when historical price or FX data changes', async () => {
    const { marketDataRevision, prisma, timeline } = context();
    await timeline.getTimeline(request);
    marketDataRevision.value++;
    await timeline.getTimeline(request);
    expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
  });

  it('does not let stale in-flight work repopulate after invalidation', async () => {
    const { prisma, timeline } = context();
    let release: (value: unknown[]) => void;
    prisma.order.findMany.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );

    const stale = timeline.getTimeline(request);
    for (let attempt = 0; attempt < 10; attempt++) {
      if (prisma.order.findMany.mock.calls.length > 0) break;
      await Promise.resolve();
    }
    timeline.invalidateForUser(request.userId);
    release!([]);
    await stale;
    await timeline.getTimeline(request);
    expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
  });
});
