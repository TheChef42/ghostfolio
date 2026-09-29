import { Injectable } from '@nestjs/common';

import { PortfolioValuationTimelineService } from '../portfolio-valuation-timeline.service';
import { TwrTimelineAdapter } from './twr-timeline.adapter';
import { TwrCalculator } from './twr.calculator';
import type { TwrResult } from './twr.types';

@Injectable()
export class TwrAnalyticsService {
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
    const prepared = this.timelineAdapter.fromTimeline(timeline);

    return this.calculator.calculate(prepared);
  }
}
