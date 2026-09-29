import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import { TwrAnalyticsService } from './twr-analytics.service';

describe('TwrAnalyticsService', () => {
  it('adapts the Phase 4A timeline before invoking the pure calculator', async () => {
    const timeline = {
      methodologyVersion: 'phase-4a-v1'
    } as PortfolioValuationTimeline;
    const prepared = { points: [] };
    const result = { method: 'TWR' };
    const calculator = { calculate: jest.fn().mockReturnValue(result) };
    const timelineAdapter = {
      fromTimeline: jest.fn().mockReturnValue(prepared)
    };
    const valuationTimelineService = {
      getTimeline: jest.fn().mockResolvedValue(timeline)
    };
    const service = new TwrAnalyticsService(
      calculator as never,
      timelineAdapter as never,
      valuationTimelineService as never
    );
    const request = {
      accountIds: ['a'],
      baseCurrency: 'DKK',
      from: '2024-01-01',
      to: '2024-01-03',
      userId: 'user'
    };

    await expect(service.getPerformance(request)).resolves.toBe(result);
    expect(valuationTimelineService.getTimeline).toHaveBeenCalledWith(request);
    expect(timelineAdapter.fromTimeline).toHaveBeenCalledWith(timeline);
    expect(calculator.calculate).toHaveBeenCalledWith(prepared);
  });
});
