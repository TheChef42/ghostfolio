import type { PortfolioValuationTimeline } from '../valuation-timeline.types';

export const MODIFIED_DIETZ_METHODOLOGY_VERSION = 'phase-4b-v1';

export type ModifiedDietzUnavailableReason =
  | 'INCOMPLETE_VALUATION_INPUT'
  | 'MISSING_CLOSING_VALUE'
  | 'MISSING_OPENING_VALUE'
  | 'NEGATIVE_EFFECTIVE_CAPITAL'
  | 'ZERO_EFFECTIVE_CAPITAL'
  | 'ZERO_LENGTH_INTERVAL';

export interface ModifiedDietzResult {
  absoluteResult: string | null;
  accountingConvention: PortfolioValuationTimeline['accountingConvention'];
  baseCurrency: string;
  closingValue: string | null;
  coverage: PortfolioValuationTimeline['coverage'];
  effectiveCapital: string | null;
  interval: PortfolioValuationTimeline['interval'];
  method: 'MODIFIED_DIETZ';
  methodologyVersion: typeof MODIFIED_DIETZ_METHODOLOGY_VERSION;
  openingValue: string | null;
  periodReturn: string | null;
  reason: ModifiedDietzUnavailableReason | null;
  scope: PortfolioValuationTimeline['scope'];
  totalExternalFlow: string | null;
  weightedExternalFlow: string | null;
}
