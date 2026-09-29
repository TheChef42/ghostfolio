import { Injectable } from '@nestjs/common';

import { PortfolioValuationTimelineService } from '../portfolio-valuation-timeline.service';
import { ModifiedDietzCalculator } from './modified-dietz.calculator';
import type { ModifiedDietzResult } from './modified-dietz.types';

@Injectable()
export class ModifiedDietzAnalyticsService {
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

    return this.calculator.calculate(timeline);
  }
}
