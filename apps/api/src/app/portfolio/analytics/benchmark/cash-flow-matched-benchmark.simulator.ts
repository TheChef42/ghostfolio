import { Injectable } from '@nestjs/common';
import { Big } from 'big.js';

import {
  BENCHMARK_METHODOLOGY_VERSION,
  BenchmarkCoverageReasonCode,
  CashFlowMatchedInput,
  CashFlowMatchedResult
} from './benchmark.types';

const Decimal = Big();
Decimal.DP = 40;

@Injectable()
export class CashFlowMatchedBenchmarkSimulator {
  public calculate(input: CashFlowMatchedInput): CashFlowMatchedResult {
    const unavailable = this.unavailableReason(input);
    if (unavailable) {
      return this.result(input, {
        reason: unavailable,
        series: [],
        status: 'UNAVAILABLE'
      });
    }

    try {
      return this.simulate(input);
    } catch {
      return this.result(input, {
        reason: 'INVALID_BENCHMARK_PRICE',
        series: [],
        status: 'UNAVAILABLE'
      });
    }
  }

  private simulate(input: CashFlowMatchedInput): CashFlowMatchedResult {
    const pointByDate = new Map(
      input.benchmarkTimeline.points.map((point) => [point.date, point])
    );
    const flowByDate = new Map<string, Big>();
    for (const flow of input.timeline.externalFlows) {
      flowByDate.set(
        flow.date,
        (flowByDate.get(flow.date) ?? new Decimal(0)).plus(
          flow.amountInBaseCurrency!
        )
      );
    }

    const openingSeed = new Decimal(
      input.timeline.opening.totalValueInBaseCurrency!
    );
    const openingPrice = new Decimal(
      input.benchmarkTimeline.points[0].priceInBaseCurrency!
    );
    let units = openingSeed.div(openingPrice);
    const series: CashFlowMatchedResult['series'] = [];

    for (const portfolioPoint of input.timeline.timeline) {
      const benchmarkPoint = pointByDate.get(portfolioPoint.date)!;
      const price = new Decimal(benchmarkPoint.priceInBaseCurrency!);
      const flow = flowByDate.get(portfolioPoint.date) ?? new Decimal(0);
      const unitsDelta = flow.div(price);
      if (unitsDelta.lt(0) && units.plus(unitsDelta).lt(0)) {
        return this.result(input, {
          reason: 'BENCHMARK_SIMULATION_EXHAUSTED',
          series,
          status: 'EXHAUSTED',
          units: units.toString()
        });
      }
      units = units.plus(unitsDelta);
      const benchmarkValue = units.mul(price);
      series.push({
        benchmarkFx: benchmarkPoint.fx!.value,
        benchmarkPriceInBaseCurrency: benchmarkPoint.priceInBaseCurrency,
        benchmarkValue: benchmarkValue.toString(),
        date: portfolioPoint.date,
        fxSourceDate: benchmarkPoint.fx!.sourceDate,
        nativeBenchmarkPrice: benchmarkPoint.nativePrice!.value,
        portfolioValue: portfolioPoint.totalValueInBaseCurrency!,
        priceSourceDate: benchmarkPoint.nativePrice!.sourceDate,
        units: units.toString()
      });
    }

    const benchmarkValue = new Decimal(series.at(-1)!.benchmarkValue!);
    const portfolioValue = new Decimal(
      input.timeline.closing.totalValueInBaseCurrency!
    );
    const difference = portfolioValue.minus(benchmarkValue);
    return this.result(input, {
      benchmarkValue: benchmarkValue.toString(),
      difference: difference.toString(),
      portfolioValue: portfolioValue.toString(),
      reason: null,
      relativeDifference: benchmarkValue.eq(0)
        ? null
        : difference.div(benchmarkValue).toString(),
      series,
      status: 'AVAILABLE',
      units: units.toString()
    });
  }

  private unavailableReason(
    input: CashFlowMatchedInput
  ): BenchmarkCoverageReasonCode | null {
    if (
      input.timeline.coverage.status !== 'COMPLETE' ||
      input.timeline.opening.totalValueInBaseCurrency === null ||
      input.timeline.closing.totalValueInBaseCurrency === null ||
      input.timeline.externalFlows.some(
        ({ amountInBaseCurrency }) => amountInBaseCurrency === null
      )
    ) {
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
    input: CashFlowMatchedInput,
    values: {
      benchmarkValue?: string | null;
      difference?: string | null;
      portfolioValue?: string | null;
      reason: BenchmarkCoverageReasonCode | null;
      relativeDifference?: string | null;
      series: CashFlowMatchedResult['series'];
      status: CashFlowMatchedResult['simulationStatus'];
      units?: string | null;
    }
  ): CashFlowMatchedResult {
    const benchmarkCoverage =
      values.reason === 'BENCHMARK_SIMULATION_EXHAUSTED'
        ? {
            reasons: [
              ...input.benchmarkTimeline.coverage.reasons,
              {
                code: 'BENCHMARK_SIMULATION_EXHAUSTED' as const,
                message:
                  'The requested withdrawal exceeds the virtual benchmark investment value.',
                severity: 'ERROR' as const
              }
            ],
            status: 'INCOMPLETE' as const
          }
        : input.benchmarkTimeline.coverage;
    return {
      accountingConvention: input.timeline.accountingConvention,
      baseCurrency: input.timeline.baseCurrency,
      benchmark: input.benchmarkTimeline.benchmark,
      benchmarkCoverage,
      benchmarkValue: values.benchmarkValue ?? null,
      difference: values.difference ?? null,
      flowSchedule: input.timeline.externalFlows,
      interval: input.timeline.interval,
      methodologyVersion: BENCHMARK_METHODOLOGY_VERSION,
      mode: 'CASH_FLOW_MATCHED',
      openingSeed: input.timeline.opening.totalValueInBaseCurrency,
      portfolioCoverage: input.timeline.coverage,
      portfolioValue:
        values.portfolioValue ??
        input.timeline.closing.totalValueInBaseCurrency,
      reason: values.reason,
      relativeDifference: values.relativeDifference ?? null,
      scope: input.timeline.scope,
      series: values.series,
      simulationStatus: values.status,
      units: values.units ?? null
    };
  }
}
