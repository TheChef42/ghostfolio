import { Injectable } from '@nestjs/common';

import { PortfolioValuationTimelineService } from '../portfolio-valuation-timeline.service';
import { XirrScheduleAdapter } from './xirr-schedule.adapter';
import { XirrCalculator } from './xirr.calculator';
import type { XirrResult } from './xirr.types';

@Injectable()
export class XirrAnalyticsService {
  public constructor(
    private readonly calculator: XirrCalculator,
    private readonly scheduleAdapter: XirrScheduleAdapter,
    private readonly valuationTimelineService: PortfolioValuationTimelineService
  ) {}

  public async getPerformance(input: {
    accountIds?: string[];
    baseCurrency: string;
    from: string;
    to: string;
    userId: string;
  }): Promise<XirrResult> {
    const timeline = await this.valuationTimelineService.getTimeline(input);
    const schedule = this.scheduleAdapter.fromTimeline(timeline);

    return this.calculator.calculate(schedule);
  }
}
