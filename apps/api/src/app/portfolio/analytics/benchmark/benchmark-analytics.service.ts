import { Injectable, Logger } from '@nestjs/common';
import type { DataSource } from '@prisma/client';

import { PortfolioValuationTimelineService } from '../portfolio-valuation-timeline.service';
import { TwrAnalyticsService } from '../twr/twr-analytics.service';
import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import { BenchmarkHistoricalValuationAdapter } from './benchmark-historical-valuation.adapter';
import type {
  BenchmarkMode,
  BenchmarkResult,
  BenchmarkReturnBasis,
  PreparedBenchmarkTimeline
} from './benchmark.types';
import { CashFlowMatchedBenchmarkSimulator } from './cash-flow-matched-benchmark.simulator';
import { TwrBenchmarkComparator } from './twr-benchmark-comparator';

@Injectable()
export class BenchmarkAnalyticsService {
  private readonly logger = new Logger(BenchmarkAnalyticsService.name);
  private readonly prepared = new WeakMap<
    PortfolioValuationTimeline,
    Map<string, Promise<PreparedBenchmarkTimeline>>
  >();

  public constructor(
    private readonly benchmarkAdapter: BenchmarkHistoricalValuationAdapter,
    private readonly cashFlowMatchedSimulator: CashFlowMatchedBenchmarkSimulator,
    private readonly timelineService: PortfolioValuationTimelineService,
    private readonly twrAnalyticsService: TwrAnalyticsService,
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
    const startedAt = performance.now();
    const benchmarkTimeline = await this.prepareBenchmark({ input, timeline });

    if (input.mode === 'CASH_FLOW_MATCHED') {
      const result = this.cashFlowMatchedSimulator.calculate({
        benchmarkTimeline,
        timeline
      });
      this.logComputeTime(startedAt);
      return result;
    }

    const twr = this.twrAnalyticsService.getFromTimeline(timeline);
    const result = this.twrComparator.calculate({
      benchmarkTimeline,
      timeline,
      twr
    });
    this.logComputeTime(startedAt);
    return result;
  }

  private prepareBenchmark({
    input,
    timeline
  }: {
    input: {
      basis?: BenchmarkReturnBasis;
      dataSource: DataSource;
      symbol: string;
    };
    timeline: PortfolioValuationTimeline;
  }) {
    let cache = this.prepared.get(timeline);
    if (!cache) {
      cache = new Map();
      this.prepared.set(timeline, cache);
    }
    const key = `${input.dataSource}\u0000${input.symbol}\u0000${input.basis ?? 'UNKNOWN'}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const promise = this.benchmarkAdapter
      .prepare({
        basis: input.basis,
        dataSource: input.dataSource,
        symbol: input.symbol,
        timeline
      })
      .catch((error) => {
        cache!.delete(key);
        throw error;
      });
    cache.set(key, promise);
    return promise;
  }

  private logComputeTime(startedAt: number) {
    this.logger.debug(
      `analytics.benchmark computeMs=${(performance.now() - startedAt).toFixed(1)}`
    );
  }
}
