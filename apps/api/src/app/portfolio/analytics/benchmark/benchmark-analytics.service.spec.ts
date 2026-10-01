import { DataSource } from '@prisma/client';

import { TwrAnalyticsService } from '../twr/twr-analytics.service';
import { XirrAnalyticsService } from '../xirr/xirr-analytics.service';
import { BenchmarkAnalyticsService } from './benchmark-analytics.service';

describe('BenchmarkAnalyticsService', () => {
  const input = {
    baseCurrency: 'DKK',
    dataSource: DataSource.YAHOO,
    from: '2024-01-01',
    mode: 'TWR' as const,
    symbol: 'IDX',
    to: '2024-01-02',
    userId: 'user'
  };

  it.each(['TWR', 'CASH_FLOW_MATCHED'] as const)(
    'loads the Phase 4A timeline once for %s mode',
    async (mode) => {
      const timeline = { timeline: [] };
      const benchmarkTimeline = { points: [] };
      const expected = { mode };
      const timelineService = {
        getTimeline: jest.fn().mockResolvedValue(timeline)
      };
      const benchmarkAdapter = {
        prepare: jest.fn().mockResolvedValue(benchmarkTimeline)
      };
      const cashFlowMatchedSimulator = {
        calculate: jest.fn().mockReturnValue(expected)
      };
      const twrAdapter = {
        fromTimeline: jest.fn().mockReturnValue('prepared')
      };
      const twrCalculator = { calculate: jest.fn().mockReturnValue('twr') };
      const twrComparator = { calculate: jest.fn().mockReturnValue(expected) };
      const service = new BenchmarkAnalyticsService(
        benchmarkAdapter as never,
        cashFlowMatchedSimulator as never,
        timelineService as never,
        twrAdapter as never,
        twrCalculator as never,
        twrComparator as never
      );

      await expect(service.getComparison({ ...input, mode })).resolves.toBe(
        expected
      );
      expect(timelineService.getTimeline).toHaveBeenCalledTimes(1);
      expect(benchmarkAdapter.prepare).toHaveBeenCalledWith({
        basis: undefined,
        dataSource: DataSource.YAHOO,
        symbol: 'IDX',
        timeline
      });
      if (mode === 'TWR') {
        expect(twrComparator.calculate).toHaveBeenCalledWith({
          benchmarkTimeline,
          timeline,
          twr: 'twr'
        });
        expect(cashFlowMatchedSimulator.calculate).not.toHaveBeenCalled();
      } else {
        expect(cashFlowMatchedSimulator.calculate).toHaveBeenCalledWith({
          benchmarkTimeline,
          timeline
        });
        expect(twrComparator.calculate).not.toHaveBeenCalled();
      }
    }
  );

  it('keeps portfolio TWR and XIRR available when benchmark pricing is unavailable', async () => {
    const timeline = {
      coverage: { reasons: [], status: 'COMPLETE' },
      timeline: []
    };
    const portfolioResult = {
      method: 'TWR',
      periodReturn: '0.1',
      reason: null
    };
    const timelineService = {
      getTimeline: jest.fn().mockResolvedValue(timeline)
    };
    const twrAdapter = {
      fromTimeline: jest.fn().mockReturnValue({ points: [] })
    };
    const twrCalculator = {
      calculate: jest.fn().mockReturnValue(portfolioResult)
    };
    const benchmarkService = new BenchmarkAnalyticsService(
      {
        prepare: jest.fn().mockResolvedValue({
          coverage: {
            reasons: [{ code: 'MISSING_BENCHMARK_PRICE' }],
            status: 'INCOMPLETE'
          },
          points: []
        })
      } as never,
      { calculate: jest.fn() } as never,
      timelineService as never,
      twrAdapter as never,
      twrCalculator as never,
      {
        calculate: jest.fn().mockReturnValue({
          benchmarkPeriodReturn: null,
          reason: 'MISSING_BENCHMARK_PRICE'
        })
      } as never
    );
    const portfolioService = new TwrAnalyticsService(
      twrCalculator as never,
      twrAdapter as never,
      timelineService as never
    );
    const xirrResult = {
      annualizedReturn: 0.12,
      method: 'XIRR',
      reason: null
    };
    const xirrService = new XirrAnalyticsService(
      { calculate: jest.fn().mockReturnValue(xirrResult) } as never,
      { fromTimeline: jest.fn().mockReturnValue({ schedule: [] }) } as never,
      timelineService as never
    );

    await expect(benchmarkService.getComparison(input)).resolves.toEqual(
      expect.objectContaining({ reason: 'MISSING_BENCHMARK_PRICE' })
    );
    await expect(portfolioService.getPerformance(input)).resolves.toBe(
      portfolioResult
    );
    await expect(xirrService.getPerformance(input)).resolves.toBe(xirrResult);
    expect(timeline.coverage.status).toBe('COMPLETE');
  });
});
