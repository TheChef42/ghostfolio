import { DateRangeFilterDto } from '@ghostfolio/api/dtos/date-range-filter.dto';
import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

import { IsIn, IsOptional, Matches } from 'class-validator';

export class GetAnalyticsPerformanceDto extends DateRangeFilterDto {
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  baseCurrency?: string;

  @IsIn([
    PerformanceCalculationType.MODIFIED_DIETZ,
    PerformanceCalculationType.XIRR
  ])
  method!:
    PerformanceCalculationType.MODIFIED_DIETZ | PerformanceCalculationType.XIRR;
}
