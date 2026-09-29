import { Injectable } from '@nestjs/common';
import { Big } from 'big.js';

import {
  BENCHMARK_METHODOLOGY_VERSION,
  BenchmarkCoverageReasonCode,
  TwrBenchmarkResult,
  TwrComparisonInput
} from './benchmark.types';

const Decimal = Big();
Decimal.DP = 40;

@Injectable()
export class TwrBenchmarkComparator {
  public calculate(input: TwrComparisonInput): TwrBenchmarkResult {
    const reason = this.unavailableReason(input);
    if (reason) {
      return this.result(input, reason, [], null);
    }

    try {
      const benchmarkByDate = new Map(
        input.benchmarkTimeline.points.map((point) => [point.date, point])
      );
      const opening = new Decimal(
        input.benchmarkTimeline.points[0].priceInBaseCurrency!
      );
      const series = input.twr.series.map((portfolioPoint) => {
        const benchmarkPoint = benchmarkByDate.get(portfolioPoint.date)!;
        const benchmarkIndex = new Decimal(
          benchmarkPoint.priceInBaseCurrency!
        ).div(opening);
        return {
          benchmarkIndex: benchmarkIndex.toString(),
          benchmarkValue: benchmarkPoint.priceInBaseCurrency,
          date: portfolioPoint.date,
          portfolioIndex: portfolioPoint.indexLevel,
          portfolioValue: portfolioPoint.portfolioValue,
          priceSourceDate: benchmarkPoint.nativePrice!.sourceDate,
          priceStalenessDays: benchmarkPoint.nativePrice!.stalenessDays
        };
      });
      const benchmarkPeriodReturn = new Decimal(
        series.at(-1)!.benchmarkIndex!
      )
        .minus(1)
        .toString();
      return this.result(input, null, series, benchmarkPeriodReturn);
    } catch {
      return this.result(input, 'INVALID_BENCHMARK_PRICE', [], null);
    }
  }

  private unavailableReason(
    input: TwrComparisonInput
  ): BenchmarkCoverageReasonCode | null {
    if (input.twr.reason === 'UNFUNDED_SEGMENT_BREAK') {
      return 'UNFUNDED_SEGMENT_BREAK';
    }
    if (input.twr.reason || input.timeline.coverage.status !== 'COMPLETE') {
      return 'INCOMPLETE_PORTFOLIO_INPUT';
    }
    if (input.benchmarkTimeline.coverage.status !== 'COMPLETE') {
      return (
        input.benchmarkTimeline.coverage.reasons.find(
          ({ severity }) => severity === 'ERROR'
        )?.code ?? 'MISSING_BENCHMARK_PRICE'
      );
    }
    return null;
  }

  private result(
    input: TwrComparisonInput,
    reason: BenchmarkCoverageReasonCode | null,
    series: TwrBenchmarkResult['series'],
    benchmarkPeriodReturn: string | null
  ): TwrBenchmarkResult {
    return {
      accountingConvention: input.timeline.accountingConvention,
      baseCurrency: input.timeline.baseCurrency,
      benchmark: input.benchmarkTimeline.benchmark,
      benchmarkCoverage: input.benchmarkTimeline.coverage,
      benchmarkPeriodReturn,
      interval: input.timeline.interval,
      methodologyVersion: BENCHMARK_METHODOLOGY_VERSION,
      mode: 'TWR',
      portfolioCoverage: input.timeline.coverage,
      portfolioPeriodReturn: reason ? null : input.twr.periodReturn,
      reason,
      scope: input.timeline.scope,
      series
    };
  }
}
