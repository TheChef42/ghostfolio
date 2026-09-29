import { resolveCustomDateRangeQuery } from '@ghostfolio/api/helper/custom-date-range.helper';
import { getIntervalFromDateRange } from '@ghostfolio/common/calculation-helper';
import { UserSettings } from '@ghostfolio/common/interfaces';
import { DateRange } from '@ghostfolio/common/types';

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
}): { from: string; to: string } {
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

  // Ghostfolio's named ranges expose an exclusive opening boundary. Analytics
  // accepts an inclusive accounting date and values the close immediately before
  // it, so the next calendar date preserves the same interval. MAX uses the Unix
  // epoch as a sentinel rather than an actual opening boundary.
  const inclusiveStartDate =
    range === 'max' ? startDate : addDays(startDate, 1);

  return {
    from: format(inclusiveStartDate, 'yyyy-MM-dd'),
    to: format(endDate, 'yyyy-MM-dd')
  };
}
