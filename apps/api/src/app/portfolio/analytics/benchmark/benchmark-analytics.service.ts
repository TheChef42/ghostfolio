import { Injectable } from '@nestjs/common';
import type { DataSource } from '@prisma/client';

import { PortfolioValuationTimelineService } from '../portfolio-valuation-timeline.service';
import { TwrTimelineAdapter } from '../twr/twr-timeline.adapter';
import { TwrCalculator } from '../twr/twr.calculator';
import { BenchmarkHistoricalValuationAdapter } from './benchmark-historical-valuation.adapter';
import type {
  BenchmarkMode,
  BenchmarkResult,
  BenchmarkReturnBasis
} from './benchmark.types';
import { CashFlowMatchedBenchmarkSimulator } from './cash-flow-matched-benchmark.simulator';
import { TwrBenchmarkComparator } from './twr-benchmark-comparator';

@Injectable()
export class BenchmarkAnalyticsService {
  public constructor(
    private readonly benchmarkAdapter: BenchmarkHistoricalValuationAdapter,
    private readonly cashFlowMatchedSimulator: CashFlowMatchedBenchmarkSimulator,
    private readonly timelineService: PortfolioValuationTimelineService,
    private readonly twrAdapter: TwrTimelineAdapter,
    private readonly twrCalculator: TwrCalculator,
    private readonly twrComparator: TwrBenchmarkComparator
  ) {}

  public async getComparison(input: {
    accountIds?: string[];
    baseCurrency: string;
    basis?: BenchmarkReturnBasis;
    dataSource: DataSource;
    from: string;
    mode: BenchmarkMode;
    symbol: string;
    to: string;
    userId: string;
  }): Promise<BenchmarkResult> {
    const timeline = await this.timelineService.getTimeline(input);
    const benchmarkTimeline = await this.benchmarkAdapter.prepare({
      basis: input.basis,
      dataSource: input.dataSource,
      symbol: input.symbol,
      timeline
    });

    if (input.mode === 'CASH_FLOW_MATCHED') {
      return this.cashFlowMatchedSimulator.calculate({
        benchmarkTimeline,
        timeline
      });
    }

    const twr = this.twrCalculator.calculate(
      this.twrAdapter.fromTimeline(timeline)
    );
    return this.twrComparator.calculate({ benchmarkTimeline, timeline, twr });
  }
}
