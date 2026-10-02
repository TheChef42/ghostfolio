import { Injectable, Logger } from '@nestjs/common';

import { PortfolioValuationTimelineService } from '../portfolio-valuation-timeline.service';
import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import { XirrScheduleAdapter } from './xirr-schedule.adapter';
import { XirrCalculator } from './xirr.calculator';
import type { XirrResult } from './xirr.types';

@Injectable()
export class XirrAnalyticsService {
  private readonly logger = new Logger(XirrAnalyticsService.name);
  private readonly results = new WeakMap<
    PortfolioValuationTimeline,
    XirrResult
  >();

  public constructor(
    private readonly calculator: XirrCalculator,
    private readonly scheduleAdapter: XirrScheduleAdapter,
    private readonly valuationTimelineService: PortfolioValuationTimelineService
  ) {}

  public async getPerformance(input: {
    accountIds?: string[];
    baseCurrency: string;
    from: string | null;
    to: string;
    userId: string;
  }): Promise<XirrResult> {
    const timeline = await this.valuationTimelineService.getTimeline(input);
    return this.getFromTimeline(timeline);
  }

  public getFromTimeline(timeline: PortfolioValuationTimeline): XirrResult {
    const cached = this.results.get(timeline);
    if (cached) return cached;
    const schedule = this.scheduleAdapter.fromTimeline(timeline);
    const startedAt = performance.now();
    const result = this.calculator.calculate(schedule);
    this.logger.debug(
      `analytics.xirr computeMs=${(performance.now() - startedAt).toFixed(1)}`
    );
    this.results.set(timeline, result);
    return result;
  }
}
