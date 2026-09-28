import {
  deleteSavedCustomDateRange,
  getValidSavedCustomDateRanges,
  isIsoAccountingDate,
  resolveCustomDateRange,
  resolveSavedCustomDateRange,
  upsertSavedCustomDateRange
} from './custom-date-range-helper';
import { SavedCustomDateRange } from './interfaces';

const TODAY = '2026-09-28';
const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';

describe('custom date range helper', () => {
  it('resolves inclusive UTC accounting-date bounds without shifting days', () => {
    const result = resolveCustomDateRange({
      from: '2024-02-29',
      to: '2024-03-01',
      today: TODAY
    });

    expect(result.from).toBe('2024-02-29');
    expect(result.to).toBe('2024-03-01');
    expect(result.startDate.toISOString()).toBe('2024-02-28T23:59:59.999Z');
    expect(result.endDate.toISOString()).toBe('2024-03-01T23:59:59.999Z');
  });

  it.each(['2024-02-30', '2024-13-01', '01/02/2024', '2024-2-01'])(
    'rejects invalid accounting date %s',
    (date) => {
      expect(isIsoAccountingDate(date)).toBe(false);
      expect(() =>
        resolveCustomDateRange({ from: date, to: TODAY, today: TODAY })
      ).toThrow('valid ISO accounting dates');
    }
  );

  it('rejects inverted and future intervals', () => {
    expect(() =>
      resolveCustomDateRange({
        from: '2026-09-20',
        to: '2026-09-19',
        today: TODAY
      })
    ).toThrow('start must not be after');
    expect(() =>
      resolveCustomDateRange({
        from: '2026-09-20',
        to: '2026-09-29',
        today: TODAY
      })
    ).toThrow('must not be in the future');
  });

  it('gives equivalent bounds one identity and distinct bounds another', () => {
    const first = resolveCustomDateRange({
      from: '2026-01-01',
      to: '2026-02-01',
      today: TODAY
    });
    const equivalent = resolveCustomDateRange({
      from: '2026-01-01',
      to: '2026-02-01',
      today: TODAY
    });
    const distinct = resolveCustomDateRange({
      from: '2026-01-02',
      to: '2026-02-01',
      today: TODAY
    });

    expect(equivalent).toEqual(first);
    expect(distinct.cacheIdentity).not.toBe(first.cacheIdentity);
  });

  it('round-trips a fixed saved range', () => {
    const range: SavedCustomDateRange = {
      endMode: 'FIXED',
      from: '2026-01-01',
      id: FIRST_ID,
      name: 'Tax year',
      to: '2026-06-30'
    };

    expect(getValidSavedCustomDateRanges([range])).toEqual([range]);
    expect(resolveSavedCustomDateRange({ range, today: TODAY }).to).toBe(
      '2026-06-30'
    );
  });

  it('keeps TODAY dynamic and resolves it only at use time', () => {
    const range: SavedCustomDateRange = {
      endMode: 'TODAY',
      from: '2026-01-01',
      id: FIRST_ID,
      name: 'Since January'
    };

    expect(range.to).toBeUndefined();
    expect(resolveSavedCustomDateRange({ range, today: '2026-09-27' }).to).toBe(
      '2026-09-27'
    );
    expect(resolveSavedCustomDateRange({ range, today: TODAY }).to).toBe(TODAY);
  });

  it('preserves an id while renaming and updates only that range', () => {
    const first: SavedCustomDateRange = {
      endMode: 'FIXED',
      from: '2026-01-01',
      id: FIRST_ID,
      name: 'Original',
      to: '2026-03-31'
    };
    const second: SavedCustomDateRange = {
      endMode: 'TODAY',
      from: '2025-01-01',
      id: SECOND_ID,
      name: 'Second'
    };
    const result = upsertSavedCustomDateRange({
      range: { ...first, name: 'Renamed' },
      ranges: [first, second]
    });

    expect(result[0]).toEqual({ ...first, name: 'Renamed' });
    expect(result[0].id).toBe(FIRST_ID);
    expect(result[1]).toEqual(second);
  });

  it('creates and deletes one saved range without altering another', () => {
    const first: SavedCustomDateRange = {
      endMode: 'TODAY',
      from: '2026-01-01',
      id: FIRST_ID,
      name: 'First'
    };
    const second = { ...first, id: SECOND_ID, name: 'Second' };
    const created = upsertSavedCustomDateRange({
      range: second,
      ranges: [first]
    });

    expect(created).toEqual([first, second]);
    expect(
      deleteSavedCustomDateRange({ id: FIRST_ID, ranges: created })
    ).toEqual([second]);
  });

  it('fails malformed or duplicate saved settings safely', () => {
    expect(getValidSavedCustomDateRanges({})).toEqual([]);
    expect(
      getValidSavedCustomDateRanges([
        {
          endMode: 'FIXED',
          from: 'invalid',
          id: FIRST_ID,
          name: 'Bad',
          to: TODAY
        }
      ])
    ).toEqual([]);
    expect(
      getValidSavedCustomDateRanges([
        {
          endMode: 'TODAY',
          from: '2026-01-01',
          id: FIRST_ID,
          name: 'One'
        },
        {
          endMode: 'TODAY',
          from: '2026-02-01',
          id: FIRST_ID,
          name: 'Duplicate'
        }
      ])
    ).toEqual([]);
  });
});
