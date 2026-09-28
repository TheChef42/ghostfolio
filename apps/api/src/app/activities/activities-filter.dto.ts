import { DATE_RANGE_PATTERN } from '@ghostfolio/api/dtos/date-range-filter.dto';
import { FilterDto } from '@ghostfolio/api/dtos/filter.dto';
import { DateRange } from '@ghostfolio/common/types';

import { Type as ActivityType } from '@prisma/client';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { isString } from 'lodash';

export class ActivitiesFilterDto extends FilterDto {
  @IsEnum(ActivityType, { each: true })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    return isString(value) ? value.split(',') : value;
  })
  activityTypes?: ActivityType[];

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(DATE_RANGE_PATTERN)
  range?: DateRange;

  @IsOptional()
  @IsUUID()
  savedRangeId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
