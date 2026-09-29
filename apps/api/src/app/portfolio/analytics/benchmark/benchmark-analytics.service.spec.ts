import { DataSource } from '@prisma/client';

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
      const twrAdapter = { fromTimeline: jest.fn().mockReturnValue('prepared') };
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
});
