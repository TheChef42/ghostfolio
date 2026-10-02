import type { DataSource } from '@prisma/client';

import type { TwrIndexPoint, TwrResult } from '../twr/twr.types';
import type {
  PortfolioValuationTimeline,
  ScopeExternalFlow,
  ValuationSource
} from '../valuation-timeline.types';

export const BENCHMARK_METHODOLOGY_VERSION = 'phase-7-v1';

export type BenchmarkMode = 'CASH_FLOW_MATCHED' | 'TWR';
export type BenchmarkReturnBasis = 'PRICE_ONLY' | 'TOTAL_RETURN' | 'UNKNOWN';
export type BenchmarkCoverageStatus = 'COMPLETE' | 'INCOMPLETE' | 'UNAVAILABLE';
export type BenchmarkCoverageReasonCode =
  | 'BENCHMARK_SIMULATION_EXHAUSTED'
  | 'INCOMPLETE_PORTFOLIO_INPUT'
  | 'INVALID_BENCHMARK_PRICE'
  | 'MISSING_BENCHMARK_FX'
  | 'MISSING_BENCHMARK_PRICE'
  | 'STALE_BENCHMARK_FX'
  | 'STALE_BENCHMARK_PRICE'
  | 'UNFUNDED_SEGMENT_BREAK'
  | 'UNKNOWN_RETURN_BASIS'
  | 'UNSUPPORTED_BENCHMARK';

export interface BenchmarkIdentity {
  basis: BenchmarkReturnBasis;
  currency: string;
  dataSource: DataSource;
  id: string;
  name: string | null;
  symbol: string;
}

export interface BenchmarkCoverageReason {
  code: BenchmarkCoverageReasonCode;
  currency?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  message: string;
  severity: 'ERROR' | 'WARNING';
  sourceDate?: string;
  symbol?: string;
  targetCurrency?: string;
}

export interface BenchmarkCoverage {
  reasons: BenchmarkCoverageReason[];
  status: BenchmarkCoverageStatus;
}

export interface BenchmarkValuationPoint {
  date: string;
  fx: ValuationSource | null;
  nativePrice: ValuationSource | null;
  priceInBaseCurrency: string | null;
}

export interface PreparedBenchmarkTimeline {
  baseCurrency: string;
  benchmark: BenchmarkIdentity | null;
  coverage: BenchmarkCoverage;
  points: BenchmarkValuationPoint[];
}

export interface BenchmarkCommonResult {
  accountingConvention: PortfolioValuationTimeline['accountingConvention'];
  baseCurrency: string;
  benchmark: BenchmarkIdentity | null;
  benchmarkCoverage: BenchmarkCoverage;
  interval: PortfolioValuationTimeline['interval'];
  methodologyVersion: typeof BENCHMARK_METHODOLOGY_VERSION;
  mode: BenchmarkMode;
  portfolioCoverage: PortfolioValuationTimeline['coverage'];
  reason: BenchmarkCoverageReasonCode | null;
  scope: PortfolioValuationTimeline['scope'];
}

export interface TwrBenchmarkPoint {
  benchmarkIndex: string | null;
  benchmarkValue: string | null;
  date: string;
  portfolioIndex: string | null;
  portfolioValue: string;
  priceSourceDate: string | null;
  priceStalenessDays: number | null;
}

export interface TwrBenchmarkResult extends BenchmarkCommonResult {
  benchmarkPeriodReturn: string | null;
  mode: 'TWR';
  portfolioPeriodReturn: string | null;
  series: TwrBenchmarkPoint[];
}

export interface CashFlowMatchedPoint {
  benchmarkFx: string | null;
  benchmarkPriceInBaseCurrency: string | null;
  benchmarkValue: string | null;
  date: string;
  fxSourceDate: string | null;
  nativeBenchmarkPrice: string | null;
  portfolioValue: string;
  priceSourceDate: string | null;
  units: string | null;
}

export interface CashFlowMatchedResult extends BenchmarkCommonResult {
  benchmarkValue: string | null;
  difference: string | null;
  flowSchedule: ScopeExternalFlow[];
  mode: 'CASH_FLOW_MATCHED';
  openingSeed: string | null;
  portfolioValue: string | null;
  relativeDifference: string | null;
  series: CashFlowMatchedPoint[];
  simulationStatus: 'AVAILABLE' | 'EXHAUSTED' | 'UNAVAILABLE';
  units: string | null;
}

export type BenchmarkResult = CashFlowMatchedResult | TwrBenchmarkResult;

export interface TwrComparisonInput {
  benchmarkTimeline: PreparedBenchmarkTimeline;
  timeline: PortfolioValuationTimeline;
  twr: TwrResult;
}

export interface CashFlowMatchedInput {
  benchmarkTimeline: PreparedBenchmarkTimeline;
  timeline: PortfolioValuationTimeline;
}

export type PortfolioTwrPoint = TwrIndexPoint;
