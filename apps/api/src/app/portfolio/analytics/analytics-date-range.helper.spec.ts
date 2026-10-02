import { BadRequestException } from '@nestjs/common';

import { resolveAnalyticsDateRangeQuery } from './analytics-date-range.helper';

const userSettings = {} as never;

describe('resolveAnalyticsDateRangeQuery', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['invalid', 'not-a-date']
  ])('does not coerce an %s custom start to the Unix epoch', (_label, from) => {
    expect(() =>
      resolveAnalyticsDateRangeQuery({
        from: from as string | undefined,
        range: 'custom',
        to: '2026-01-31',
        userSettings
      })
    ).toThrow(BadRequestException);
  });

  it('preserves a valid explicit custom interval', () => {
    expect(
      resolveAnalyticsDateRangeQuery({
        from: '2026-01-01',
        range: 'custom',
        to: '2026-01-31',
        userSettings
      })
    ).toEqual(
      expect.objectContaining({ from: '2026-01-01', to: '2026-01-31' })
    );
  });

  it('resolves a named range without an epoch fallback', () => {
    const result = resolveAnalyticsDateRangeQuery({
      range: 'ytd',
      userSettings
    });

    expect(result.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.from).not.toBe('1970-01-01');
    expect(result.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('leaves MAX start resolution to the scoped valuation timeline', () => {
    const result = resolveAnalyticsDateRangeQuery({
      range: 'max',
      userSettings
    });

    expect(result.from).toBeNull();
    expect(result.to).not.toBe('1970-01-01');
  });
});
