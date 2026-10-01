import { Injectable, Logger } from '@nestjs/common';

import { PortfolioValuationTimelineService } from '../portfolio-valuation-timeline.service';
import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import { TwrTimelineAdapter } from './twr-timeline.adapter';
import { TwrCalculator } from './twr.calculator';
import type { TwrResult } from './twr.types';

@Injectable()
export class TwrAnalyticsService {
  private readonly logger = new Logger(TwrAnalyticsService.name);
  private readonly results = new WeakMap<
    PortfolioValuationTimeline,
    TwrResult
  >();

  public constructor(
    private readonly calculator: TwrCalculator,
    private readonly timelineAdapter: TwrTimelineAdapter,
    private readonly valuationTimelineService: PortfolioValuationTimelineService
  ) {}

  public async getPerformance(input: {
    accountIds?: string[];
    baseCurrency: string;
    from: string;
    to: string;
    userId: string;
  }): Promise<TwrResult> {
    const timeline = await this.valuationTimelineService.getTimeline(input);
    return this.getFromTimeline(timeline);
  }

  public getFromTimeline(timeline: PortfolioValuationTimeline): TwrResult {
    const cached = this.results.get(timeline);
    if (cached) return cached;
    const prepared = this.timelineAdapter.fromTimeline(timeline);
    const startedAt = performance.now();
    const result = this.calculator.calculate(prepared);
    this.logger.debug(
      `analytics.twr computeMs=${(performance.now() - startedAt).toFixed(1)}`
    );
    this.results.set(timeline, result);
    return result;
  }
}
