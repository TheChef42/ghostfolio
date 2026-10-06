import { Injectable } from '@nestjs/common';
import { Big } from 'big.js';

import {
  TWR_METHODOLOGY_VERSION,
  TwrIndexPoint,
  TwrPreparedInput,
  TwrResult,
  TwrSegment,
  TwrUnavailableReason
} from './twr.types';

const Decimal = Big();
Decimal.DP = 40;

interface WorkingSegment {
  endDate: string;
  factor: Big;
  hasGapBefore: boolean;
  id: number;
  startDate: string;
}

@Injectable()
export class TwrCalculator {
  public calculate(input: TwrPreparedInput): TwrResult {
    if (input.preparationReason) {
      return this.result(input, {
        reason: input.preparationReason,
        segments: [],
        series: []
      });
    }
    if (input.points.length < 2) {
      return this.result(input, {
        reason: 'INVALID_TIMELINE',
        segments: [],
        series: []
      });
    }

    try {
      return this.calculateChain(input);
    } catch {
      return this.result(input, {
        reason: 'INCOMPLETE_VALUATION_INPUT',
        segments: [],
        series: []
      });
    }
  }

  private calculateChain(input: TwrPreparedInput): TwrResult {
    const first = input.points[0];
    const opening = new Decimal(first.portfolioValue);
    if (opening.lt(0)) {
      return this.unavailable(input, 'ZERO_OR_NEGATIVE_CAPITAL');
    }

    const series: TwrIndexPoint[] = [];
    const segments: WorkingSegment[] = [];
    let activeSegment: WorkingSegment | null = null;
    let cumulativeNetContributions = new Decimal(0);

    if (opening.gt(0)) {
      activeSegment = this.startSegment(first.date, false, segments);
      series.push(
        this.indexPoint(
          first,
          'SEGMENT_START',
          activeSegment,
          opening,
          cumulativeNetContributions
        )
      );
    } else {
      series.push(
        this.indexPoint(
          first,
          'UNFUNDED',
          null,
          opening,
          cumulativeNetContributions
        )
      );
    }

    for (let index = 1; index < input.points.length; index++) {
      const point = input.points[index];
      const previousValue = new Decimal(input.points[index - 1].portfolioValue);
      const portfolioValue = new Decimal(point.portfolioValue);
      const externalFlow = new Decimal(point.externalFlow);
      cumulativeNetContributions =
        cumulativeNetContributions.plus(externalFlow);

      if (previousValue.lt(0) || portfolioValue.lt(0)) {
        return this.unavailable(input, 'ZERO_OR_NEGATIVE_CAPITAL');
      }

      if (previousValue.eq(0)) {
        if (portfolioValue.eq(0)) {
          if (!externalFlow.eq(0)) {
            return this.unavailable(input, 'ZERO_OR_NEGATIVE_CAPITAL');
          }
          series.push(
            this.indexPoint(
              point,
              'UNFUNDED',
              null,
              opening,
              cumulativeNetContributions
            )
          );
          continue;
        }
        if (externalFlow.lte(0)) {
          return this.unavailable(input, 'ZERO_OR_NEGATIVE_CAPITAL');
        }

        activeSegment = this.startSegment(
          point.date,
          segments.length > 0,
          segments
        );
        series.push(
          this.indexPoint(
            point,
            'SEGMENT_START',
            activeSegment,
            opening,
            cumulativeNetContributions
          )
        );
        continue;
      }

      if (!activeSegment) {
        return this.unavailable(input, 'INVALID_TIMELINE');
      }

      const adjustedClosingValue = portfolioValue.minus(externalFlow);
      if (adjustedClosingValue.lt(0)) {
        return this.unavailable(input, 'ZERO_OR_NEGATIVE_CAPITAL');
      }
      const factor = adjustedClosingValue.div(previousValue);
      activeSegment.factor = activeSegment.factor.times(factor);
      activeSegment.endDate = point.date;
      series.push({
        ...point,
        boundary: portfolioValue.eq(0) ? 'SEGMENT_END' : 'CONTINUE',
        chainFactor: factor.toString(),
        cumulativeGainLoss: portfolioValue
          .minus(opening)
          .minus(cumulativeNetContributions)
          .toString(),
        cumulativeNetContributions: cumulativeNetContributions.toString(),
        indexLevel: activeSegment.factor.toString(),
        investedCapital: opening.plus(cumulativeNetContributions).toString(),
        segmentId: activeSegment.id,
        subperiodReturn: factor.minus(1).toString()
      });

      if (portfolioValue.eq(0)) {
        activeSegment = null;
      }
    }

    if (segments.length === 0) {
      return this.result(input, {
        reason: 'ZERO_OR_NEGATIVE_CAPITAL',
        segments: [],
        series
      });
    }

    const completedSegments = segments.map<TwrSegment>((segment) => ({
      endDate: segment.endDate,
      hasGapBefore: segment.hasGapBefore,
      id: segment.id,
      periodReturn: segment.factor.minus(1).toString(),
      startDate: segment.startDate
    }));
    const hasSegmentBreak = completedSegments.length > 1;

    return this.result(input, {
      periodReturn: hasSegmentBreak ? null : completedSegments[0].periodReturn,
      reason: hasSegmentBreak ? 'UNFUNDED_SEGMENT_BREAK' : null,
      segments: completedSegments,
      series
    });
  }

  private indexPoint(
    point: TwrPreparedInput['points'][number],
    boundary: TwrIndexPoint['boundary'],
    segment: WorkingSegment | null,
    opening: Big,
    cumulativeNetContributions: Big
  ): TwrIndexPoint {
    const portfolioValue = new Decimal(point.portfolioValue);
    return {
      ...point,
      boundary,
      chainFactor: segment ? '1' : null,
      cumulativeGainLoss: portfolioValue
        .minus(opening)
        .minus(cumulativeNetContributions)
        .toString(),
      cumulativeNetContributions: cumulativeNetContributions.toString(),
      indexLevel: segment ? segment.factor.toString() : null,
      investedCapital: opening.plus(cumulativeNetContributions).toString(),
      segmentId: segment?.id ?? null,
      subperiodReturn: null
    };
  }

  private result(
    input: TwrPreparedInput,
    {
      periodReturn = null,
      reason,
      segments,
      series
    }: {
      periodReturn?: string | null;
      reason: TwrUnavailableReason | null;
      segments: TwrSegment[];
      series: TwrIndexPoint[];
    }
  ): TwrResult {
    return {
      accountingConvention: input.accountingConvention,
      baseCurrency: input.baseCurrency,
      closingValue: input.closingValue,
      coverage: input.coverage,
      interval: input.interval,
      method: 'TWR',
      methodologyVersion: TWR_METHODOLOGY_VERSION,
      openingValue: input.openingValue,
      periodReturn,
      reason,
      scope: input.scope,
      segmentCount: segments.length,
      segments,
      series
    };
  }

  private startSegment(
    date: string,
    hasGapBefore: boolean,
    segments: WorkingSegment[]
  ): WorkingSegment {
    const segment = {
      endDate: date,
      factor: new Decimal(1),
      hasGapBefore,
      id: segments.length + 1,
      startDate: date
    };
    segments.push(segment);

    return segment;
  }

  private unavailable(
    input: TwrPreparedInput,
    reason: TwrUnavailableReason
  ): TwrResult {
    return this.result(input, { reason, segments: [], series: [] });
  }
}
