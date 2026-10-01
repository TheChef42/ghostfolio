import { Injectable, Logger } from '@nestjs/common';

import { PortfolioValuationTimelineService } from '../portfolio-valuation-timeline.service';
import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import { ModifiedDietzCalculator } from './modified-dietz.calculator';
import type { ModifiedDietzResult } from './modified-dietz.types';

@Injectable()
export class ModifiedDietzAnalyticsService {
  private readonly logger = new Logger(ModifiedDietzAnalyticsService.name);
  private readonly results = new WeakMap<
    PortfolioValuationTimeline,
    ModifiedDietzResult
  >();

  public constructor(
    private readonly calculator: ModifiedDietzCalculator,
    private readonly valuationTimelineService: PortfolioValuationTimelineService
  ) {}

  public async getPerformance(input: {
    accountIds?: string[];
    baseCurrency: string;
    from: string;
    to: string;
    userId: string;
  }): Promise<ModifiedDietzResult> {
    const timeline = await this.valuationTimelineService.getTimeline(input);
    return this.getFromTimeline(timeline);
  }

  public getFromTimeline(
    timeline: PortfolioValuationTimeline
  ): ModifiedDietzResult {
    const cached = this.results.get(timeline);
    if (cached) return cached;
    const startedAt = performance.now();
    const result = this.calculator.calculate(timeline);
    this.logger.debug(
      `analytics.dietz computeMs=${(performance.now() - startedAt).toFixed(1)}`
    );
    this.results.set(timeline, result);
    return result;
  }
}
