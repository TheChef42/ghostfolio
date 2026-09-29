import { REQUIRES_SCOPE_KEY } from '@ghostfolio/api/decorators/requires-scope.decorator';
import { scopes } from '@ghostfolio/common/scopes';

import { VERSION_METADATA } from '@nestjs/common/constants';

import { PortfolioController } from './portfolio.controller';

describe('PortfolioController analytics valuation endpoint', () => {
  const handler = PortfolioController.prototype.getValuationTimeline;

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
