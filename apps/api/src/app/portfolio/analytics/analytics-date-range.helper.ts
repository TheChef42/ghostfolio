import { resolveCustomDateRangeQuery } from '@ghostfolio/api/helper/custom-date-range.helper';
import { getIntervalFromDateRange } from '@ghostfolio/common/calculation-helper';
import { isIsoAccountingDate } from '@ghostfolio/common/custom-date-range-helper';
import { UserSettings } from '@ghostfolio/common/interfaces';
import { DateRange } from '@ghostfolio/common/types';

import { BadRequestException } from '@nestjs/common';
import { addDays, format } from 'date-fns';

export function resolveAnalyticsDateRangeQuery({
  from,
  range,
  savedRangeId,
  to,
  userSettings
}: {
  from?: string;
  range: DateRange;
  savedRangeId?: string;
  to?: string;
  userSettings: UserSettings;
}): { from: string | null; to: string } {
  const customInterval = resolveCustomDateRangeQuery({
    from,
    range,
    savedRangeId,
    to,
    userSettings
  });

  if (customInterval) {
    return customInterval;
  }

  const { endDate, startDate } = getIntervalFromDateRange({
    dateRange: range
  });

  // Ghostfolio's MAX interval uses the Unix epoch only as an internal sentinel.
  // The valuation service resolves its real start from the first scoped economic
  // record while loading the canonical timeline.
  const fromDate =
    range === 'max' ? null : format(addDays(startDate, 1), 'yyyy-MM-dd');
  const toDate = format(endDate, 'yyyy-MM-dd');

  if (
    (fromDate !== null && !isIsoAccountingDate(fromDate)) ||
    !isIsoAccountingDate(toDate) ||
    (fromDate !== null && fromDate > toDate)
  ) {
    throw new BadRequestException('The resolved analytics range is invalid');
  }

  return {
    from: fromDate,
    to: toDate
  };
}
