import { Injectable } from '@nestjs/common';
import { Big } from 'big.js';

import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import type {
  XirrPreparedInput,
  XirrScheduleEntry,
  XirrScheduleSource,
  XirrUnavailableReason
} from './xirr.types';

interface DatedAmount {
  amount: string;
  date: string;
  source: XirrScheduleSource;
}

@Injectable()
export class XirrScheduleAdapter {
  public fromTimeline(timeline: PortfolioValuationTimeline): XirrPreparedInput {
    const openingValue = timeline.opening.totalValueInBaseCurrency;
    const closingValue = timeline.closing.totalValueInBaseCurrency;
    const preparationReason = this.getPreparationReason({
      closingValue,
      openingValue,
      timeline
    });
    let schedule: XirrScheduleEntry[] = [];

    if (preparationReason === null) {
      try {
        schedule = this.mergeByDate([
          {
            amount: new Big(openingValue!).times(-1).toString(),
            date: timeline.interval.openingDate,
            source: 'OPENING_VALUE'
          },
          ...timeline.externalFlows.map(({ amountInBaseCurrency, date }) => ({
            amount: new Big(amountInBaseCurrency!).times(-1).toString(),
            date,
            source: 'EXTERNAL_FLOW' as const
          })),
          {
            amount: closingValue!,
            date: timeline.interval.to,
            source: 'CLOSING_VALUE'
          }
        ]);
      } catch {
        return this.result(timeline, [], 'INCOMPLETE_VALUATION_INPUT');
      }
    }

    return this.result(timeline, schedule, preparationReason);
  }

  private getPreparationReason({
    closingValue,
    openingValue,
    timeline
  }: {
    closingValue: string | null;
    openingValue: string | null;
    timeline: PortfolioValuationTimeline;
  }): XirrUnavailableReason | null {
    if (openingValue === null) {
      return 'MISSING_OPENING_VALUE';
    }
    if (closingValue === null) {
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
      return 'INCOMPLETE_VALUATION_INPUT';
    }
    if (
      this.day(timeline.interval.to) <= this.day(timeline.interval.openingDate)
    ) {
      return 'ZERO_DURATION';
    }

    return null;
  }

  private day(date: string): number {
    return Date.parse(`${date}T00:00:00.000Z`);
  }

  private mergeByDate(items: DatedAmount[]): XirrScheduleEntry[] {
    const byDate = new Map<
      string,
      { amount: Big; sources: Set<XirrScheduleSource> }
    >();

    for (const item of items) {
      const existing = byDate.get(item.date) ?? {
        amount: new Big(0),
        sources: new Set<XirrScheduleSource>()
      };
      existing.amount = existing.amount.plus(item.amount);
      existing.sources.add(item.source);
      byDate.set(item.date, existing);
    }

    return [...byDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .filter(([, { amount }]) => !amount.eq(0))
      .map(([date, { amount, sources }]) => ({
        amount: amount.toString(),
        date,
        sources: [...sources].sort()
      }));
  }

  private result(
    timeline: PortfolioValuationTimeline,
    schedule: XirrScheduleEntry[],
    preparationReason: XirrUnavailableReason | null
  ): XirrPreparedInput {
    return {
      accountingConvention: timeline.accountingConvention,
      baseCurrency: timeline.baseCurrency,
      closingValue: timeline.closing.totalValueInBaseCurrency,
      coverage: timeline.coverage,
      interval: timeline.interval,
      openingValue: timeline.opening.totalValueInBaseCurrency,
      preparationReason,
      schedule,
      scope: timeline.scope
    };
  }
}
