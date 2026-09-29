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
