import { DATE_RANGES, DEFAULT_DATE_RANGE } from '@ghostfolio/common/config';
import { DateRange } from '@ghostfolio/common/types';

import { Matches } from 'class-validator';
import { IsOptional, IsUUID } from 'class-validator';

import { FilterDto } from './filter.dto';

// A named date range or a calendar year like '2024', '2023', '2022', etc.
export const DATE_RANGE_PATTERN = new RegExp(
  `^(${DATE_RANGES.join('|')}|custom|\\d{4})$`
);

export class DateRangeFilterDto extends FilterDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @Matches(DATE_RANGE_PATTERN)
  range?: DateRange = DEFAULT_DATE_RANGE;

  @IsOptional()
  @IsUUID()
  savedRangeId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
