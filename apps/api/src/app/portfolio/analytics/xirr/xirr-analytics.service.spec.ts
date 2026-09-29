import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import { XirrAnalyticsService } from './xirr-analytics.service';

describe('XirrAnalyticsService', () => {
  it('adapts the Phase 4A timeline before invoking the pure calculator', async () => {
    const timeline = {
      methodologyVersion: 'phase-4a-v1'
    } as PortfolioValuationTimeline;
    const prepared = { schedule: [] };
    const result = { method: 'XIRR' };
    const calculator = { calculate: jest.fn().mockReturnValue(result) };
    const scheduleAdapter = {
      fromTimeline: jest.fn().mockReturnValue(prepared)
    };
    const valuationTimelineService = {
      getTimeline: jest.fn().mockResolvedValue(timeline)
    };
    const service = new XirrAnalyticsService(
      calculator as never,
      scheduleAdapter as never,
      valuationTimelineService as never
    );
    const request = {
      accountIds: ['a'],
      baseCurrency: 'DKK',
      from: '2024-01-01',
      to: '2024-12-31',
      userId: 'user'
    };

    await expect(service.getPerformance(request)).resolves.toBe(result);
    expect(valuationTimelineService.getTimeline).toHaveBeenCalledWith(request);
    expect(scheduleAdapter.fromTimeline).toHaveBeenCalledWith(timeline);
    expect(calculator.calculate).toHaveBeenCalledWith(prepared);
  });
});
