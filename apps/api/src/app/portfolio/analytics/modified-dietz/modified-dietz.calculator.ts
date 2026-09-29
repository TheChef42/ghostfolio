import { Injectable } from '@nestjs/common';
import { Big } from 'big.js';

import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import {
  MODIFIED_DIETZ_METHODOLOGY_VERSION,
  ModifiedDietzResult,
  ModifiedDietzUnavailableReason
} from './modified-dietz.types';

const Decimal = Big();
Decimal.DP = 40;

@Injectable()
export class ModifiedDietzCalculator {
  public calculate(timeline: PortfolioValuationTimeline): ModifiedDietzResult {
    const openingValue = timeline.opening.totalValueInBaseCurrency;
    const closingValue = timeline.closing.totalValueInBaseCurrency;
    const start = this.atEndOfDay(timeline.interval.openingDate);
    const end = this.atEndOfDay(timeline.interval.to);
    const duration = end - start;
    const flowDiagnostics = this.calculateFlows({
      duration,
      end,
      start,
      timeline
    });
    const absoluteResult = this.absoluteResult({
      closingValue,
      openingValue,
      totalExternalFlow: flowDiagnostics?.totalExternalFlow ?? null
    });
    const effectiveCapital =
      openingValue !== null && flowDiagnostics
        ? new Decimal(openingValue)
            .plus(flowDiagnostics.weightedExternalFlow)
            .toString()
        : null;

    const unavailableReason = this.getUnavailableReason({
      closingValue,
      duration,
      effectiveCapital,
      flowDiagnosticsAvailable: flowDiagnostics !== null,
      openingValue,
      timeline
    });

    return {
      absoluteResult,
      accountingConvention: timeline.accountingConvention,
      baseCurrency: timeline.baseCurrency,
      closingValue,
      coverage: timeline.coverage,
      effectiveCapital,
      interval: timeline.interval,
      method: 'MODIFIED_DIETZ',
      methodologyVersion: MODIFIED_DIETZ_METHODOLOGY_VERSION,
      openingValue,
      periodReturn:
        unavailableReason === null && absoluteResult !== null
          ? new Decimal(absoluteResult).div(effectiveCapital!).toString()
          : null,
      reason: unavailableReason,
      scope: timeline.scope,
      totalExternalFlow: flowDiagnostics?.totalExternalFlow ?? null,
      weightedExternalFlow: flowDiagnostics?.weightedExternalFlow ?? null
    };
  }

  private absoluteResult({
    closingValue,
    openingValue,
    totalExternalFlow
  }: {
    closingValue: string | null;
    openingValue: string | null;
    totalExternalFlow: string | null;
  }): string | null {
    if (
      closingValue === null ||
      openingValue === null ||
      totalExternalFlow === null
    ) {
      return null;
    }

    return new Decimal(closingValue)
      .minus(openingValue)
      .minus(totalExternalFlow)
      .toString();
  }

  private atEndOfDay(date: string): number {
    return Date.parse(`${date}T23:59:59.999Z`);
  }

  private calculateFlows({
    duration,
    end,
    start,
    timeline
  }: {
    duration: number;
    end: number;
    start: number;
    timeline: PortfolioValuationTimeline;
  }): { totalExternalFlow: string; weightedExternalFlow: string } | null {
    if (!Number.isFinite(duration) || duration <= 0) {
      return null;
    }

    try {
      let totalExternalFlow = new Decimal(0);
      let weightedExternalFlow = new Decimal(0);

      for (const flow of timeline.externalFlows) {
        if (flow.amountInBaseCurrency === null) {
          return null;
        }

        const flowTime = this.atEndOfDay(flow.date);
        if (!Number.isFinite(flowTime) || flowTime < start || flowTime > end) {
          return null;
        }

        const amount = new Decimal(flow.amountInBaseCurrency);
        const weight = new Decimal(String(end - flowTime)).div(
          String(duration)
        );
        totalExternalFlow = totalExternalFlow.plus(amount);
        weightedExternalFlow = weightedExternalFlow.plus(amount.times(weight));
      }

      return {
        totalExternalFlow: totalExternalFlow.toString(),
        weightedExternalFlow: weightedExternalFlow.toString()
      };
    } catch {
      return null;
    }
  }

  private getUnavailableReason({
    closingValue,
    duration,
    effectiveCapital,
    flowDiagnosticsAvailable,
    openingValue,
    timeline
  }: {
    closingValue: string | null;
    duration: number;
    effectiveCapital: string | null;
    flowDiagnosticsAvailable: boolean;
    openingValue: string | null;
    timeline: PortfolioValuationTimeline;
  }): ModifiedDietzUnavailableReason | null {
    if (openingValue === null) {
      return 'MISSING_OPENING_VALUE';
    }
    if (closingValue === null) {
      return 'MISSING_CLOSING_VALUE';
    }
    if (timeline.coverage.status !== 'COMPLETE') {
      return 'INCOMPLETE_VALUATION_INPUT';
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      return 'ZERO_LENGTH_INTERVAL';
    }
    if (!flowDiagnosticsAvailable || effectiveCapital === null) {
      return 'INCOMPLETE_VALUATION_INPUT';
    }

    const denominator = new Decimal(effectiveCapital);
    if (denominator.eq(0)) {
      return 'ZERO_EFFECTIVE_CAPITAL';
    }
    if (denominator.lt(0)) {
      return 'NEGATIVE_EFFECTIVE_CAPITAL';
    }

    return null;
  }
}
