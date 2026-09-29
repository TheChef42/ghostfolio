import { DateRangeFilterDto } from '@ghostfolio/api/dtos/date-range-filter.dto';

import { IsIn, IsNotEmpty, IsOptional, Matches } from 'class-validator';

import type { BenchmarkMode } from './analytics/benchmark/benchmark.types';

export class GetAnalyticsBenchmarkDto extends DateRangeFilterDto {
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  baseCurrency?: string;

  @IsIn(['CASH_FLOW_MATCHED', 'TWR'])
  mode!: BenchmarkMode;

  @IsNotEmpty()
  declare symbol: string;
}
