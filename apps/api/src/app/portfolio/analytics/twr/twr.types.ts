import type { PortfolioValuationTimeline } from '../valuation-timeline.types';

export const TWR_METHODOLOGY_VERSION = 'phase-6-v1';

export type TwrUnavailableReason =
  | 'INCOMPLETE_VALUATION_INPUT'
  | 'INVALID_TIMELINE'
  | 'MISSING_CLOSING_VALUE'
  | 'MISSING_FLOW_VALUE'
  | 'MISSING_OPENING_VALUE'
  | 'UNFUNDED_SEGMENT_BREAK'
  | 'ZERO_OR_NEGATIVE_CAPITAL';

export interface TwrTimelinePoint {
  date: string;
  externalFlow: string;
  portfolioValue: string;
}

export interface TwrPreparedInput {
  accountingConvention: PortfolioValuationTimeline['accountingConvention'];
  baseCurrency: string;
  closingValue: string | null;
  coverage: PortfolioValuationTimeline['coverage'];
  interval: PortfolioValuationTimeline['interval'];
  openingValue: string | null;
  points: TwrTimelinePoint[];
  preparationReason: TwrUnavailableReason | null;
  scope: PortfolioValuationTimeline['scope'];
}

export interface TwrIndexPoint extends TwrTimelinePoint {
  boundary: 'CONTINUE' | 'SEGMENT_END' | 'SEGMENT_START' | 'UNFUNDED';
  chainFactor: string | null;
  indexLevel: string | null;
  segmentId: number | null;
  subperiodReturn: string | null;
}

export interface TwrSegment {
  endDate: string;
  hasGapBefore: boolean;
  id: number;
  periodReturn: string;
  startDate: string;
}

export interface TwrResult {
  accountingConvention: PortfolioValuationTimeline['accountingConvention'];
  baseCurrency: string;
  closingValue: string | null;
  coverage: PortfolioValuationTimeline['coverage'];
  interval: PortfolioValuationTimeline['interval'];
  method: 'TWR';
  methodologyVersion: typeof TWR_METHODOLOGY_VERSION;
  openingValue: string | null;
  periodReturn: string | null;
  reason: TwrUnavailableReason | null;
  scope: PortfolioValuationTimeline['scope'];
  segmentCount: number;
  segments: TwrSegment[];
  series: TwrIndexPoint[];
}
