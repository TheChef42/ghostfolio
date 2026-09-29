import { REQUIRES_SCOPE_KEY } from '@ghostfolio/api/decorators/requires-scope.decorator';
import { scopes } from '@ghostfolio/common/scopes';

import { VERSION_METADATA } from '@nestjs/common/constants';

import { PortfolioController } from './portfolio.controller';

describe.each([
  ['benchmark', PortfolioController.prototype.getAnalyticsBenchmark],
  ['performance', PortfolioController.prototype.getAnalyticsPerformance],
  ['valuation', PortfolioController.prototype.getValuationTimeline]
])('PortfolioController analytics %s endpoint', (_name, handler) => {
  it('requires portfolio access including monetary values', () => {
    expect(Reflect.getMetadata(REQUIRES_SCOPE_KEY, handler)).toEqual([
      scopes.portfolioRead,
      scopes.portfolioReadValues
    ]);
  });

  it('uses the explicit version 1 analytics boundary', () => {
    expect(Reflect.getMetadata(VERSION_METADATA, handler)).toBe('1');
  });
});

describe('PortfolioController analytics benchmark dispatch', () => {
  it('resolves the shared interval and explicit benchmark identity', async () => {
    const result = { mode: 'TWR' };
    const context = {
      benchmarkAnalyticsService: {
        getComparison: jest.fn().mockResolvedValue(result)
      }
    };
    await expect(
      PortfolioController.prototype.getAnalyticsBenchmark.call(
        context as never,
        {
          userId: 'user',
          userSettings: { baseCurrency: 'DKK' }
        } as never,
        {
          dataSource: 'YAHOO',
          from: '2024-01-01',
          mode: 'TWR',
          range: 'custom',
          symbol: 'IDX',
          to: '2024-01-31'
        } as never
      )
    ).resolves.toBe(result);
    expect(
      context.benchmarkAnalyticsService.getComparison
    ).toHaveBeenCalledWith({
      accountIds: undefined,
      baseCurrency: 'DKK',
      dataSource: 'YAHOO',
      from: '2024-01-01',
      mode: 'TWR',
      symbol: 'IDX',
      to: '2024-01-31',
      userId: 'user'
    });
  });

  it('rejects a request without explicit benchmark identity', async () => {
    await expect(
      PortfolioController.prototype.getAnalyticsBenchmark.call(
        { benchmarkAnalyticsService: {} } as never,
        {
          userId: 'user',
          userSettings: { baseCurrency: 'DKK' }
        } as never,
        {
          from: '2024-01-01',
          mode: 'TWR',
          range: 'custom',
          to: '2024-01-31'
        } as never
      )
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('PortfolioController analytics method dispatch', () => {
  it('routes TWR through its separate analytics service', async () => {
    const twrResult = { method: 'TWR' };
    const context = {
      modifiedDietzAnalyticsService: { getPerformance: jest.fn() },
      twrAnalyticsService: {
        getPerformance: jest.fn().mockResolvedValue(twrResult)
      },
      xirrAnalyticsService: { getPerformance: jest.fn() }
    };

    await expect(
      PortfolioController.prototype.getAnalyticsPerformance.call(
        context as never,
        {
          userId: 'user',
          userSettings: { baseCurrency: 'DKK' }
        } as never,
        {
          from: '2024-01-01',
          method: 'TWR',
          range: 'custom',
          to: '2024-12-31'
        } as never
      )
    ).resolves.toBe(twrResult);
    expect(context.twrAnalyticsService.getPerformance).toHaveBeenCalledWith({
      accountIds: undefined,
      baseCurrency: 'DKK',
      from: '2024-01-01',
      to: '2024-12-31',
      userId: 'user'
    });
    expect(
      context.modifiedDietzAnalyticsService.getPerformance
    ).not.toHaveBeenCalled();
    expect(context.xirrAnalyticsService.getPerformance).not.toHaveBeenCalled();
  });

  it('routes XIRR through its separate analytics service', async () => {
    const xirrResult = { method: 'XIRR' };
    const context = {
      modifiedDietzAnalyticsService: { getPerformance: jest.fn() },
      twrAnalyticsService: { getPerformance: jest.fn() },
      xirrAnalyticsService: {
        getPerformance: jest.fn().mockResolvedValue(xirrResult)
      }
    };

    await expect(
      PortfolioController.prototype.getAnalyticsPerformance.call(
        context as never,
        {
          userId: 'user',
          userSettings: { baseCurrency: 'DKK' }
        } as never,
        {
          from: '2024-01-01',
          method: 'XIRR',
          range: 'custom',
          to: '2024-12-31'
        } as never
      )
    ).resolves.toBe(xirrResult);
    expect(context.xirrAnalyticsService.getPerformance).toHaveBeenCalledWith({
      accountIds: undefined,
      baseCurrency: 'DKK',
      from: '2024-01-01',
      to: '2024-12-31',
      userId: 'user'
    });
    expect(
      context.modifiedDietzAnalyticsService.getPerformance
    ).not.toHaveBeenCalled();
  });
});

const SAVED_RANGE_ID = '11111111-1111-4111-8111-111111111111';

const analyticsIntervalEndpoints = [
  {
    invoke: ({ context, query, userSettings }) =>
      PortfolioController.prototype.getValuationTimeline.call(
        context as never,
        { userId: 'user', userSettings } as never,
        query as never
      ),
    name: 'valuation',
    query: {},
    service: 'portfolioValuationTimelineService'
  },
  {
    invoke: ({ context, query, userSettings }) =>
      PortfolioController.prototype.getAnalyticsPerformance.call(
        context as never,
        { userId: 'user', userSettings } as never,
        query as never
      ),
    name: 'performance',
    query: { method: 'TWR' },
    service: 'twrAnalyticsService'
  },
  {
    invoke: ({ context, query, userSettings }) =>
      PortfolioController.prototype.getAnalyticsBenchmark.call(
        context as never,
        { userId: 'user', userSettings } as never,
        query as never
      ),
    name: 'benchmark',
    query: {
      dataSource: 'YAHOO',
      mode: 'TWR',
      symbol: 'IDX'
    },
    service: 'benchmarkAnalyticsService'
  }
] as const;

describe.each(analyticsIntervalEndpoints)(
  'PortfolioController analytics $name interval resolution',
  ({ invoke, query: endpointQuery, service }) => {
    const userSettings = {
      baseCurrency: 'DKK',
      customDateRanges: [
        {
          endMode: 'FIXED',
          from: '2024-02-01',
          id: SAVED_RANGE_ID,
          name: 'Saved interval',
          to: '2024-02-29'
        }
      ]
    };

    function createContext() {
      return {
        benchmarkAnalyticsService: { getComparison: jest.fn() },
        modifiedDietzAnalyticsService: { getPerformance: jest.fn() },
        portfolioValuationTimelineService: { getTimeline: jest.fn() },
        twrAnalyticsService: { getPerformance: jest.fn() },
        xirrAnalyticsService: { getPerformance: jest.fn() }
      };
    }

    function getServiceMock(context: ReturnType<typeof createContext>) {
      if (service === 'benchmarkAnalyticsService') {
        return context.benchmarkAnalyticsService.getComparison;
      }
      if (service === 'portfolioValuationTimelineService') {
        return context.portfolioValuationTimelineService.getTimeline;
      }
      return context.twrAnalyticsService.getPerformance;
    }

    beforeAll(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-09-29T12:00:00.000Z'));
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    it('resolves YTD with Ghostfolio named-range semantics', async () => {
      const context = createContext();

      await invoke({
        context,
        query: { ...endpointQuery, range: 'ytd' },
        userSettings
      });

      expect(getServiceMock(context)).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2026-01-01', to: '2026-09-29' })
      );
    });

    it('resolves another named range with the same semantics', async () => {
      const context = createContext();

      await invoke({
        context,
        query: { ...endpointQuery, range: '1y' },
        userSettings
      });

      expect(getServiceMock(context)).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2025-09-30', to: '2026-09-29' })
      );
    });

    it('preserves explicit custom bounds', async () => {
      const context = createContext();

      await invoke({
        context,
        query: {
          ...endpointQuery,
          from: '2024-01-01',
          range: 'custom',
          to: '2024-01-31'
        },
        userSettings
      });

      expect(getServiceMock(context)).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2024-01-01', to: '2024-01-31' })
      );
    });

    it('preserves saved custom ranges', async () => {
      const context = createContext();

      await invoke({
        context,
        query: {
          ...endpointQuery,
          range: 'custom',
          savedRangeId: SAVED_RANGE_ID
        },
        userSettings
      });

      expect(getServiceMock(context)).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2024-02-01', to: '2024-02-29' })
      );
    });

    it('continues to reject custom bounds combined with a named range', async () => {
      const context = createContext();

      await expect(
        invoke({
          context,
          query: {
            ...endpointQuery,
            from: '2024-01-01',
            range: 'ytd'
          },
          userSettings
        })
      ).rejects.toMatchObject({ status: 400 });

      expect(getServiceMock(context)).not.toHaveBeenCalled();
    });
  }
);
