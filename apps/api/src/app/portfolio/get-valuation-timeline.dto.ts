import { DateRangeFilterDto } from '@ghostfolio/api/dtos/date-range-filter.dto';

import { IsOptional, Matches } from 'class-validator';

export class GetValuationTimelineDto extends DateRangeFilterDto {
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  baseCurrency?: string;
}
