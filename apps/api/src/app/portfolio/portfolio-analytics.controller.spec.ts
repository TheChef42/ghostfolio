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
    expect(context.benchmarkAnalyticsService.getComparison).toHaveBeenCalledWith({
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
