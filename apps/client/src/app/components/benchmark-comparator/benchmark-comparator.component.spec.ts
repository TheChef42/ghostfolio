import { toAnalyticsChartValue } from './benchmark-comparator.util';

describe('benchmark comparator chart values', () => {
  it('uses the same percentage units for portfolio and benchmark returns', () => {
    expect(toAnalyticsChartValue(0.1097, 'PERFORMANCE')).toBeCloseTo(10.97);
    expect(toAnalyticsChartValue(0.1547, 'PERFORMANCE')).toBeCloseTo(15.47);
  });

  it.each(['GAIN_LOSS', 'TOTAL_VALUE'] as const)(
    'keeps monetary values unchanged in %s mode',
    (mode) => {
      expect(toAnalyticsChartValue(1234.56, mode)).toBe(1234.56);
    }
  );

  it('uses null for a missing chart value', () => {
    expect(toAnalyticsChartValue(undefined, 'PERFORMANCE')).toBeNull();
  });
});
