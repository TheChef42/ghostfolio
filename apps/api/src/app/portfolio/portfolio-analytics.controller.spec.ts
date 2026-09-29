import { REQUIRES_SCOPE_KEY } from '@ghostfolio/api/decorators/requires-scope.decorator';
import { scopes } from '@ghostfolio/common/scopes';

import { VERSION_METADATA } from '@nestjs/common/constants';

import { PortfolioController } from './portfolio.controller';

describe.each([
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

describe('PortfolioController analytics method dispatch', () => {
  it('routes XIRR through its separate analytics service', async () => {
    const xirrResult = { method: 'XIRR' };
    const context = {
      modifiedDietzAnalyticsService: { getPerformance: jest.fn() },
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
