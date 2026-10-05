import type { DataSource } from '@prisma/client';

export type AnalyticsCoverageStatus = 'COMPLETE' | 'INCOMPLETE' | 'UNAVAILABLE';
export type AnalyticsPerformanceMethod = 'MODIFIED_DIETZ' | 'TWR' | 'XIRR';
export type AnalyticsBenchmarkMode = 'CASH_FLOW_MATCHED' | 'TWR';
export type AnalyticsBenchmarkBasis = 'PRICE_ONLY' | 'TOTAL_RETURN' | 'UNKNOWN';

export interface AnalyticsInterval {
  from: string;
  openingDate: string;
  to: string;
}

export interface AnalyticsCoverageReason {
  accountName?: string;
  code: string;
  currency?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  difference?: string;
  expected?: string;
  message: string;
  openingCashDate?: string;
  openingCashSource?:
    | 'ACCOUNT_BALANCE'
    | 'ACCOUNT_NOT_YET_IN_EXISTENCE'
    | 'INFERRED_ZERO_FIRST_FUNDING';
  reconstructed?: string;
  severity?: 'ERROR' | 'WARNING';
  sourceDate?: string;
  symbol?: string;
  targetCurrency?: string;
  tolerance?: string;
}

export interface AnalyticsCoverage {
  reasons: AnalyticsCoverageReason[];
  status: AnalyticsCoverageStatus;
}

export interface AnalyticsScope {
  accountIds: string[];
  identity: string;
  type: 'ACCOUNT_SUBSET' | 'WHOLE_PORTFOLIO';
}

export interface AnalyticsPerformanceBase {
  baseCurrency: string;
  closingValue: string | null;
  coverage: AnalyticsCoverage;
  interval: AnalyticsInterval;
  method: AnalyticsPerformanceMethod;
  methodologyVersion: string;
  openingValue: string | null;
  reason: string | null;
  scope: AnalyticsScope;
}

export interface AnalyticsTwrPoint {
  boundary: 'CONTINUE' | 'SEGMENT_END' | 'SEGMENT_START' | 'UNFUNDED';
  chainFactor: string | null;
  date: string;
  externalFlow: string;
  indexLevel: string | null;
  portfolioValue: string;
  segmentId: number | null;
  subperiodReturn: string | null;
}

export interface AnalyticsTwrResponse extends AnalyticsPerformanceBase {
  method: 'TWR';
  periodReturn: string | null;
  segmentCount: number;
  series: AnalyticsTwrPoint[];
}

export interface AnalyticsXirrResponse extends AnalyticsPerformanceBase {
  annualizedReturn: number | null;
  method: 'XIRR';
  rootCount: number | null;
  scheduleEntryCount: number;
  signChangeCount: number;
}

export interface AnalyticsModifiedDietzResponse extends AnalyticsPerformanceBase {
  absoluteResult: string | null;
  effectiveCapital: string | null;
  method: 'MODIFIED_DIETZ';
  periodReturn: string | null;
  totalExternalFlow: string | null;
}

export interface AnalyticsBenchmarkIdentity {
  basis: AnalyticsBenchmarkBasis;
  currency: string;
  dataSource: DataSource;
  id: string;
  name: string | null;
  symbol: string;
}

export interface AnalyticsBenchmarkPoint {
  benchmarkIndex: string | null;
  benchmarkValue: string | null;
  date: string;
  portfolioIndex: string | null;
  portfolioValue: string;
  priceSourceDate: string | null;
  priceStalenessDays: number | null;
}

export interface AnalyticsBenchmarkBase {
  baseCurrency: string;
  benchmark: AnalyticsBenchmarkIdentity | null;
  benchmarkCoverage: AnalyticsCoverage;
  interval: AnalyticsInterval;
  methodologyVersion: string;
  mode: AnalyticsBenchmarkMode;
  portfolioCoverage: AnalyticsCoverage;
  reason: string | null;
  scope: AnalyticsScope;
}

export interface AnalyticsTwrBenchmarkResponse extends AnalyticsBenchmarkBase {
  benchmarkPeriodReturn: string | null;
  mode: 'TWR';
  portfolioPeriodReturn: string | null;
  series: AnalyticsBenchmarkPoint[];
}

export interface AnalyticsCashFlowMatchedResponse extends AnalyticsBenchmarkBase {
  benchmarkValue: string | null;
  difference: string | null;
  mode: 'CASH_FLOW_MATCHED';
  openingSeed: string | null;
  portfolioValue: string | null;
  relativeDifference: string | null;
  simulationStatus: 'AVAILABLE' | 'EXHAUSTED' | 'UNAVAILABLE';
  units: string | null;
}

export type AnalyticsPerformanceResponse =
  AnalyticsModifiedDietzResponse | AnalyticsTwrResponse | AnalyticsXirrResponse;

export type AnalyticsBenchmarkResponse =
  AnalyticsCashFlowMatchedResponse | AnalyticsTwrBenchmarkResponse;
