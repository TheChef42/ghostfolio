import { ResolvedCustomDateRange, SavedCustomDateRange } from './interfaces';

export const ISO_ACCOUNTING_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CustomDateRangeError extends Error {}

export function getUtcAccountingDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function isIsoAccountingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_ACCOUNTING_DATE_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return getUtcAccountingDate(date) === value;
}

export function resolveCustomDateRange({
  from,
  to,
  today = getUtcAccountingDate()
}: {
  from: string;
  to: string;
  today?: string;
}): ResolvedCustomDateRange {
  if (!isIsoAccountingDate(from) || !isIsoAccountingDate(to)) {
    throw new CustomDateRangeError(
      'Custom date bounds must be valid ISO accounting dates'
    );
  }

  if (!isIsoAccountingDate(today)) {
    throw new CustomDateRangeError('The current accounting date is invalid');
  }

  if (from > to) {
    throw new CustomDateRangeError(
      'The custom range start must not be after its end'
    );
  }

  if (to > today) {
    throw new CustomDateRangeError(
      'The custom range end must not be in the future'
    );
  }

  const startOfFrom = Date.parse(`${from}T00:00:00.000Z`);
  const startOfDayAfterTo = Date.parse(`${to}T00:00:00.000Z`) + 86_400_000;

  return {
    cacheIdentity: `${from}:${to}`,
    endDate: new Date(startOfDayAfterTo - 1),
    from,
    startDate: new Date(startOfFrom - 1),
    to
  };
}

export function resolveSavedCustomDateRange({
  range,
  today = getUtcAccountingDate()
}: {
  range: SavedCustomDateRange;
  today?: string;
}): ResolvedCustomDateRange {
  const to = range.endMode === 'TODAY' ? today : range.to;

  if (!to) {
    throw new Error('A fixed custom date range requires an end date');
  }

  return resolveCustomDateRange({
    from: range.from,
    to,
    today
  });
}

export function isSavedCustomDateRange(
  value: unknown
): value is SavedCustomDateRange {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const range = value as SavedCustomDateRange;
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      range.id
    );

  if (
    !isUuid ||
    typeof range.name !== 'string' ||
    range.name.trim().length === 0 ||
    range.name.length > 100 ||
    !isIsoAccountingDate(range.from) ||
    !['FIXED', 'TODAY'].includes(range.endMode)
  ) {
    return false;
  }

  return range.endMode === 'TODAY'
    ? range.to === undefined
    : isIsoAccountingDate(range.to);
}

export function getValidSavedCustomDateRanges(
  value: unknown
): SavedCustomDateRange[] {
  if (!Array.isArray(value) || !value.every(isSavedCustomDateRange)) {
    return [];
  }

  const ids = new Set(value.map(({ id }) => id));

  return ids.size === value.length ? value : [];
}

export function upsertSavedCustomDateRange({
  range,
  ranges
}: {
  range: SavedCustomDateRange;
  ranges: SavedCustomDateRange[];
}): SavedCustomDateRange[] {
  const index = ranges.findIndex(({ id }) => id === range.id);

  if (index === -1) {
    return [...ranges, range];
  }

  const result = [...ranges];
  result[index] = range;
  return result;
}

export function deleteSavedCustomDateRange({
  id,
  ranges
}: {
  id: string;
  ranges: SavedCustomDateRange[];
}): SavedCustomDateRange[] {
  return ranges.filter(({ id: rangeId }) => rangeId !== id);
}
