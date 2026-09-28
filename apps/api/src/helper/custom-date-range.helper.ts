import {
  CustomDateRangeError,
  resolveCustomDateRange,
  resolveSavedCustomDateRange
} from '@ghostfolio/common/custom-date-range-helper';
import {
  ResolvedCustomDateRange,
  UserSettings
} from '@ghostfolio/common/interfaces';
import { DateRange } from '@ghostfolio/common/types';

import { BadRequestException } from '@nestjs/common';

export function resolveCustomDateRangeQuery({
  from,
  range,
  savedRangeId,
  to,
  today,
  userSettings
}: {
  from?: string;
  range: DateRange;
  savedRangeId?: string;
  to?: string;
  today?: string;
  userSettings: UserSettings;
}): ResolvedCustomDateRange | undefined {
  const hasCustomValues = !!from || !!to || !!savedRangeId;

  if (range !== 'custom') {
    if (hasCustomValues) {
      throw new BadRequestException(
        'Explicit custom bounds cannot be combined with a named range'
      );
    }

    return undefined;
  }

  try {
    if (savedRangeId) {
      if (from || to) {
        throw new CustomDateRangeError(
          'A saved range cannot be combined with explicit bounds'
        );
      }

      const savedRange = userSettings.customDateRanges?.find(
        ({ id }) => id === savedRangeId
      );

      if (!savedRange) {
        throw new CustomDateRangeError('The saved custom range was not found');
      }

      return resolveSavedCustomDateRange({ range: savedRange, today });
    }

    if (!from || !to) {
      throw new CustomDateRangeError(
        'A custom range requires both from and to bounds'
      );
    }

    return resolveCustomDateRange({ from, to, today });
  } catch (error) {
    if (error instanceof CustomDateRangeError) {
      throw new BadRequestException(error.message);
    }

    throw error;
  }
}
