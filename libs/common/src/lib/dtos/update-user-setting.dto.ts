import { ISO_ACCOUNTING_DATE_PATTERN } from '@ghostfolio/common/custom-date-range-helper';
import { XRayRulesSettings } from '@ghostfolio/common/interfaces';
import type {
  CustomDateRangeSelection,
  SavedCustomDateRange
} from '@ghostfolio/common/interfaces';
import type {
  ColorScheme,
  DateRange,
  HoldingsViewMode,
  ViewMode
} from '@ghostfolio/common/types';
import { IsCurrencyCode } from '@ghostfolio/common/validators/is-currency-code';

import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsISO8601,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested
} from 'class-validator';
import { eachYearOfInterval, format } from 'date-fns';

export class CustomDateRangeSelectionDto implements CustomDateRangeSelection {
  @IsOptional()
  @Matches(ISO_ACCOUNTING_DATE_PATTERN)
  from?: string;

  @IsOptional()
  @IsUUID()
  savedRangeId?: string;

  @IsOptional()
  @Matches(ISO_ACCOUNTING_DATE_PATTERN)
  to?: string;
}

export class SavedCustomDateRangeDto implements SavedCustomDateRange {
  @IsIn(['FIXED', 'TODAY'])
  endMode: 'FIXED' | 'TODAY';

  @Matches(ISO_ACCOUNTING_DATE_PATTERN)
  from: string;

  @IsUUID()
  id: string;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @Matches(ISO_ACCOUNTING_DATE_PATTERN)
  to?: string;
}

export class UpdateUserSettingDto {
  @IsNumber()
  @IsOptional()
  annualInterestRate?: number;

  @IsCurrencyCode()
  @IsOptional()
  baseCurrency?: string;

  @IsString()
  @IsOptional()
  benchmark?: string;

  @IsIn(['DARK', 'LIGHT'] as ColorScheme[])
  @IsOptional()
  colorScheme?: ColorScheme;

  @IsOptional()
  @Type(() => CustomDateRangeSelectionDto)
  @ValidateNested()
  customDateRange?: CustomDateRangeSelectionDto | null;

  @IsArray()
  @IsOptional()
  @Type(() => SavedCustomDateRangeDto)
  @ValidateNested({ each: true })
  customDateRanges?: SavedCustomDateRangeDto[];

  @IsIn([
    '1d',
    '1y',
    '5y',
    'custom',
    'max',
    'mtd',
    'wtd',
    'ytd',
    ...eachYearOfInterval({ end: new Date(), start: new Date(0) }).map(
      (date) => {
        return format(date, 'yyyy');
      }
    )
  ] as DateRange[])
  @IsOptional()
  dateRange?: DateRange;

  @IsNumber()
  @IsOptional()
  emergencyFund?: number;

  @IsArray()
  @IsOptional()
  'filters.accounts'?: string[] | null;

  @IsArray()
  @IsOptional()
  'filters.assetClasses'?: string[] | null;

  @IsString()
  @IsOptional()
  'filters.dataSource'?: string | null;

  @IsString()
  @IsOptional()
  'filters.symbol'?: string | null;

  @IsArray()
  @IsOptional()
  'filters.tags'?: string[] | null;

  @IsIn(['CHART', 'TABLE'] as HoldingsViewMode[])
  @IsOptional()
  holdingsViewMode?: HoldingsViewMode;

  @IsBoolean()
  @IsOptional()
  isExperimentalFeatures?: boolean;

  @IsBoolean()
  @IsOptional()
  isRestrictedView?: boolean;

  @IsString()
  @IsOptional()
  language?: string;

  @IsString()
  @IsOptional()
  locale?: string;

  /**
   * The target financial amount the user aims to reach before retiring.
   * Can be explicitly set to null to clear the value and calculate it dynamically.
   */
  @IsNumber()
  @IsOptional()
  projectedTotalAmount?: number | null;

  /**
   * The target date when the user plans to retire.
   * Can be explicitly set to null to clear the value and calculate it dynamically.
   */
  @IsISO8601()
  @IsOptional()
  retirementDate?: string | null;

  @IsNumber()
  @IsOptional()
  safeWithdrawalRate?: number;

  @IsNumber()
  @IsOptional()
  savingsRate?: number;

  @IsIn(['DEFAULT', 'ZEN'] as ViewMode[])
  @IsOptional()
  viewMode?: ViewMode;

  @IsOptional()
  xRayRules?: XRayRulesSettings;
}
