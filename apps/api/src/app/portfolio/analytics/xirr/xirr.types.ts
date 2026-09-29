import type { PortfolioValuationTimeline } from '../valuation-timeline.types';

export const XIRR_METHODOLOGY_VERSION = 'phase-5-v1';
export const XIRR_NORMALIZED_RESIDUAL_TOLERANCE = 1e-10;
export const XIRR_SEARCH_DOMAIN = { maximumX: 50, minimumX: -20 } as const;

export type XirrUnavailableReason =
  | 'EMPTY_SCHEDULE'
  | 'INCOMPLETE_VALUATION_INPUT'
  | 'MISSING_CLOSING_VALUE'
  | 'MISSING_OPENING_VALUE'
  | 'MULTIPLE_ROOTS'
  | 'NO_VALID_ROOT'
  | 'NUMERICAL_NON_CONVERGENCE'
  | 'NUMERICAL_OVERFLOW'
  | 'ONE_SIGN_ONLY'
  | 'ZERO_DURATION';

export type XirrScheduleSource =
  'CLOSING_VALUE' | 'EXTERNAL_FLOW' | 'OPENING_VALUE';

export interface XirrScheduleEntry {
  amount: string;
  date: string;
  sources: XirrScheduleSource[];
}

export interface XirrPreparedInput {
  accountingConvention: PortfolioValuationTimeline['accountingConvention'];
  baseCurrency: string;
  closingValue: string | null;
  coverage: PortfolioValuationTimeline['coverage'];
  interval: PortfolioValuationTimeline['interval'];
  openingValue: string | null;
  preparationReason: XirrUnavailableReason | null;
  schedule: XirrScheduleEntry[];
  scope: PortfolioValuationTimeline['scope'];
}

export interface XirrResult {
  accountingConvention: PortfolioValuationTimeline['accountingConvention'];
  annualizedReturn: number | null;
  baseCurrency: string;
  closingValue: string | null;
  coverage: PortfolioValuationTimeline['coverage'];
  interval: PortfolioValuationTimeline['interval'];
  method: 'XIRR';
  methodologyVersion: typeof XIRR_METHODOLOGY_VERSION;
  normalizedResidual: number | null;
  openingValue: string | null;
  reason: XirrUnavailableReason | null;
  rootCount: number | null;
  schedule: XirrScheduleEntry[];
  scheduleEntryCount: number;
  scope: PortfolioValuationTimeline['scope'];
  signChangeCount: number;
}
