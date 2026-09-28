import { getIntervalFromDateRange } from '@ghostfolio/common/calculation-helper';
import { UserSettings } from '@ghostfolio/common/interfaces';

import { BadRequestException } from '@nestjs/common';

import { resolveCustomDateRangeQuery } from './custom-date-range.helper';

const RANGE_ID = '11111111-1111-4111-8111-111111111111';

describe('resolveCustomDateRangeQuery', () => {
  const settings: UserSettings = {
    customDateRanges: [
      {
        endMode: 'TODAY',
        from: '2026-01-01',
        id: RANGE_ID,
        name: 'Year so far'
      }
    ]
  };

  it('resolves one-off bounds deterministically', () => {
    const result = resolveCustomDateRangeQuery({
      from: '2026-02-01',
      range: 'custom',
      to: '2026-02-28',
      today: '2026-09-28',
      userSettings: settings
    });

    expect(result).toMatchObject({
      cacheIdentity: '2026-02-01:2026-02-28',
      from: '2026-02-01',
      to: '2026-02-28'
    });
  });

  it('resolves a saved TODAY range at request time', () => {
    expect(
      resolveCustomDateRangeQuery({
        range: 'custom',
        savedRangeId: RANGE_ID,
        today: '2026-09-27',
        userSettings: settings
      })?.to
    ).toBe('2026-09-27');

    expect(
      resolveCustomDateRangeQuery({
        range: 'custom',
        savedRangeId: RANGE_ID,
        today: '2026-09-28',
        userSettings: settings
      })?.to
    ).toBe('2026-09-28');
  });

  it('rejects missing, mixed, and unknown custom input', () => {
    expect(() =>
      resolveCustomDateRangeQuery({
        from: '2026-01-01',
        range: 'custom',
        userSettings: settings
      })
    ).toThrow(BadRequestException);
    expect(() =>
      resolveCustomDateRangeQuery({
        from: '2026-01-01',
        range: 'ytd',
        to: '2026-02-01',
        userSettings: settings
      })
    ).toThrow(BadRequestException);
    expect(() =>
      resolveCustomDateRangeQuery({
        range: 'custom',
        savedRangeId: '22222222-2222-4222-8222-222222222222',
        userSettings: settings
      })
    ).toThrow(BadRequestException);
  });

  it.each(['1d', 'wtd', 'mtd', 'ytd', '1y', '5y', 'max', '2024'])(
    'leaves the existing %s named-range path unchanged',
    (range) => {
      expect(
        resolveCustomDateRangeQuery({ range, userSettings: settings })
      ).toBeUndefined();
      expect(() =>
        getIntervalFromDateRange({ dateRange: range })
      ).not.toThrow();
    }
  );
});
