import {
  CustomDateRangeSelection,
  SavedCustomDateRange
} from '@ghostfolio/common/interfaces/custom-date-range.interface';
import { XRayRulesSettings } from '@ghostfolio/common/interfaces/x-ray-rules-settings.interface';
import {
  ColorScheme,
  DateRange,
  HoldingsViewMode,
  ViewMode
} from '@ghostfolio/common/types';
import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

import { AssetClass } from '@prisma/client';

export interface UserSettings {
  annualInterestRate?: number;
  baseCurrency?: string;
  benchmark?: string;
  colorScheme?: ColorScheme;
  customDateRange?: CustomDateRangeSelection;
  customDateRanges?: SavedCustomDateRange[];
  dateRange?: DateRange;
  emergencyFund?: number;
  'filters.accounts'?: string[];
  'filters.assetClasses'?: AssetClass[];
  'filters.dataSource'?: string;
  'filters.symbol'?: string;
  'filters.tags'?: string[];
  holdingsViewMode?: HoldingsViewMode;
  isExperimentalFeatures?: boolean;
  isRestrictedView?: boolean;
  language?: string;
  locale?: string;
  performanceCalculationType?: PerformanceCalculationType;
  projectedTotalAmount?: number;
  retirementDate?: string;
  safeWithdrawalRate?: number;
  savingsRate?: number;
  viewMode?: ViewMode;
  xRayRules?: XRayRulesSettings;
}
