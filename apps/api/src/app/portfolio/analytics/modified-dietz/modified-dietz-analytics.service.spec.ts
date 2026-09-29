import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import { ModifiedDietzAnalyticsService } from './modified-dietz-analytics.service';

describe('ModifiedDietzAnalyticsService', () => {
  it('uses the Phase 4A timeline as its only normalized input', async () => {
    const timeline = {
      methodologyVersion: 'phase-4a-v1'
    } as PortfolioValuationTimeline;
    const result = { method: 'MODIFIED_DIETZ' } as const;
    const calculator = {
      calculate: jest.fn().mockReturnValue(result)
    };
    const valuationTimelineService = {
      getTimeline: jest.fn().mockResolvedValue(timeline)
    };
    const service = new ModifiedDietzAnalyticsService(
      calculator as never,
      valuationTimelineService as never
    );
    const input = {
      accountIds: ['a'],
      baseCurrency: 'DKK',
      from: '2024-01-01',
      to: '2024-01-10',
      userId: 'user'
    };

    await expect(service.getPerformance(input)).resolves.toBe(result);
    expect(valuationTimelineService.getTimeline).toHaveBeenCalledWith(input);
    expect(calculator.calculate).toHaveBeenCalledWith(timeline);
  });
});
