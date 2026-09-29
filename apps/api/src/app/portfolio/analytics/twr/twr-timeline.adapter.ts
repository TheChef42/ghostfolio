import { Injectable } from '@nestjs/common';
import { Big } from 'big.js';

import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import type {
  TwrPreparedInput,
  TwrTimelinePoint,
  TwrUnavailableReason
} from './twr.types';

@Injectable()
export class TwrTimelineAdapter {
  public fromTimeline(timeline: PortfolioValuationTimeline): TwrPreparedInput {
    const preparationReason = this.getPreparationReason(timeline);
    if (preparationReason) {
      return this.result(timeline, [], preparationReason);
    }

    try {
      const flowByDate = new Map<string, Big>();
      for (const flow of timeline.externalFlows) {
        flowByDate.set(
          flow.date,
          (flowByDate.get(flow.date) ?? new Big(0)).plus(
            flow.amountInBaseCurrency!
          )
        );
      }
      const points = timeline.timeline.map<TwrTimelinePoint>(
        ({ date, totalValueInBaseCurrency }) => ({
          date,
          externalFlow: (flowByDate.get(date) ?? new Big(0)).toString(),
          portfolioValue: new Big(totalValueInBaseCurrency!).toString()
        })
      );

      return this.result(timeline, points, null);
    } catch {
      return this.result(timeline, [], 'INCOMPLETE_VALUATION_INPUT');
    }
  }

  private day(date: string): number {
    return Date.parse(`${date}T00:00:00.000Z`);
  }

  private getPreparationReason(
    timeline: PortfolioValuationTimeline
  ): TwrUnavailableReason | null {
    if (timeline.opening.totalValueInBaseCurrency === null) {
      return 'MISSING_OPENING_VALUE';
    }
    if (timeline.closing.totalValueInBaseCurrency === null) {
      return 'MISSING_CLOSING_VALUE';
    }
    if (timeline.coverage.status !== 'COMPLETE') {
      return 'INCOMPLETE_VALUATION_INPUT';
    }
    if (
      timeline.externalFlows.some(
        ({ amountInBaseCurrency }) => amountInBaseCurrency === null
      )
    ) {
      return 'MISSING_FLOW_VALUE';
    }
    if (
      timeline.timeline.length < 2 ||
      timeline.timeline[0].date !== timeline.interval.openingDate ||
      timeline.timeline.at(-1)?.date !== timeline.interval.to
    ) {
      return 'INVALID_TIMELINE';
    }

    for (let index = 0; index < timeline.timeline.length; index++) {
      const point = timeline.timeline[index];
      if (point.totalValueInBaseCurrency === null) {
        return 'INCOMPLETE_VALUATION_INPUT';
      }
      if (index > 0) {
        const previous = timeline.timeline[index - 1];
        const difference = this.day(point.date) - this.day(previous.date);
        if (!Number.isFinite(difference) || difference !== 86_400_000) {
          return 'INVALID_TIMELINE';
        }
      }
    }

    const timelineDates = new Set(timeline.timeline.map(({ date }) => date));
    if (timeline.externalFlows.some(({ date }) => !timelineDates.has(date))) {
      return 'INVALID_TIMELINE';
    }

    return null;
  }

  private result(
    timeline: PortfolioValuationTimeline,
    points: TwrTimelinePoint[],
    preparationReason: TwrUnavailableReason | null
  ): TwrPreparedInput {
    return {
      accountingConvention: timeline.accountingConvention,
      baseCurrency: timeline.baseCurrency,
      closingValue: timeline.closing.totalValueInBaseCurrency,
      coverage: timeline.coverage,
      interval: timeline.interval,
      openingValue: timeline.opening.totalValueInBaseCurrency,
      points,
      preparationReason,
      scope: timeline.scope
    };
  }
}
