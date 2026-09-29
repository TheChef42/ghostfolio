import { Big } from 'big.js';

import { TwrCalculator } from './twr.calculator';
import type { TwrPreparedInput, TwrTimelinePoint } from './twr.types';

const calculator = new TwrCalculator();
const Decimal = Big();
Decimal.DP = 40;

function point(
  date: string,
  portfolioValue: string,
  externalFlow = '0'
): TwrTimelinePoint {
  return { date, externalFlow, portfolioValue };
}

function input(
  points: TwrTimelinePoint[],
  preparationReason: TwrPreparedInput['preparationReason'] = null
): TwrPreparedInput {
  return {
    accountingConvention: {
      activityTiming: 'END_OF_DAY',
      opening: 'CLOSE_BEFORE_FROM',
      timezone: 'UTC'
    },
    baseCurrency: 'DKK',
    closingValue: points.at(-1)?.portfolioValue ?? null,
    coverage: { reasons: [], status: 'COMPLETE' },
    interval: {
      from: points[1]?.date ?? '2024-01-01',
      openingDate: points[0]?.date ?? '2023-12-31',
      to: points.at(-1)?.date ?? '2024-01-01'
    },
    openingValue: points[0]?.portfolioValue ?? null,
    points,
    preparationReason,
    scope: { accountIds: ['a'], identity: 'a', type: 'WHOLE_PORTFOLIO' }
  };
}

describe('TwrCalculator', () => {
  it.each([
    [
      'no move and no flow',
      [point('2023-12-31', '100'), point('2024-01-01', '100')],
      '0'
    ],
    [
      'ten percent gain',
      [point('2023-12-31', '100'), point('2024-01-01', '110')],
      '0.1'
    ],
    [
      'deposit and no move',
      [point('2023-12-31', '100'), point('2024-01-01', '150', '50')],
      '0'
    ],
    [
      'withdrawal and no move',
      [point('2023-12-31', '100'), point('2024-01-01', '60', '-40')],
      '0'
    ],
    [
      'dividend as performance',
      [point('2023-12-31', '100'), point('2024-01-01', '110')],
      '0.1'
    ],
    [
      'fee as performance',
      [point('2023-12-31', '100'), point('2024-01-01', '95')],
      '-0.05'
    ],
    [
      'BUY as an internal transformation',
      [point('2023-12-31', '100'), point('2024-01-01', '100')],
      '0'
    ],
    [
      'SELL as an internal transformation',
      [point('2023-12-31', '100'), point('2024-01-01', '100')],
      '0'
    ]
  ])('calculates %s', (_name, points, periodReturn) => {
    expect(calculator.calculate(input(points))).toEqual(
      expect.objectContaining({ periodReturn, reason: null, segmentCount: 1 })
    );
  });

  it('chains a gain followed by a neutral deposit without an index jump', () => {
    const result = calculator.calculate(
      input([
        point('2023-12-31', '100'),
        point('2024-01-01', '110'),
        point('2024-01-02', '160', '50')
      ])
    );
    expect(result.periodReturn).toBe('0.1');
    expect(result.series.map(({ indexLevel }) => indexLevel)).toEqual([
      '1',
      '1.1',
      '1.1'
    ]);
  });

  it('removes a deposit before chaining a later gain', () => {
    const result = calculator.calculate(
      input([
        point('2023-12-31', '100'),
        point('2024-01-01', '150', '50'),
        point('2024-01-02', '165')
      ])
    );
    expect(result.periodReturn).toBe('0.1');
  });

  it('matches an independently calculated multi-day chain', () => {
    const result = calculator.calculate(
      input([
        point('2023-12-31', '100'),
        point('2024-01-01', '110'),
        point('2024-01-02', '165', '50'),
        point('2024-01-03', '150', '-20'),
        point('2024-01-04', '153')
      ])
    );
    const expected = new Decimal('1.1')
      .times(new Decimal('115').div('110'))
      .times(new Decimal('170').div('165'))
      .times(new Decimal('153').div('150'))
      .minus(1);
    expect(new Decimal(result.periodReturn!).eq(expected)).toBe(true);
  });

  it('uses first funding to establish a base without assigning a return', () => {
    const result = calculator.calculate(
      input([
        point('2023-12-31', '0'),
        point('2024-01-01', '50', '50'),
        point('2024-01-02', '55')
      ])
    );
    expect(result).toEqual(
      expect.objectContaining({
        periodReturn: '0.1',
        reason: null,
        segmentCount: 1
      })
    );
    expect(result.series[1]).toEqual(
      expect.objectContaining({
        boundary: 'SEGMENT_START',
        indexLevel: '1',
        subperiodReturn: null
      })
    );
  });

  it('closes a fully liquidated segment without dividing by zero', () => {
    const result = calculator.calculate(
      input([
        point('2023-12-31', '100'),
        point('2024-01-01', '0', '-100'),
        point('2024-01-02', '0')
      ])
    );
    expect(result).toEqual(
      expect.objectContaining({
        periodReturn: '0',
        reason: null,
        segmentCount: 1
      })
    );
    expect(result.series[1].boundary).toBe('SEGMENT_END');
  });

  it('exposes re-funding as an unavailable multi-segment break', () => {
    const result = calculator.calculate(
      input([
        point('2023-12-31', '100'),
        point('2024-01-01', '0', '-100'),
        point('2024-01-02', '0'),
        point('2024-01-03', '50', '50'),
        point('2024-01-04', '55')
      ])
    );
    expect(result).toEqual(
      expect.objectContaining({
        periodReturn: null,
        reason: 'UNFUNDED_SEGMENT_BREAK',
        segmentCount: 2
      })
    );
    expect(result.segments[1]).toEqual(
      expect.objectContaining({ hasGapBefore: true, periodReturn: '0.1' })
    );
    expect(result.series[2].indexLevel).toBeNull();
    expect(result.series[3].indexLevel).toBe('1');
  });

  it.each([
    [
      'negative opening value',
      [point('2023-12-31', '-1'), point('2024-01-01', '1')]
    ],
    [
      'negative closing value',
      [point('2023-12-31', '1'), point('2024-01-01', '-1')]
    ],
    [
      'value without funding',
      [point('2023-12-31', '0'), point('2024-01-01', '1')]
    ]
  ])('returns null for %s', (_name, points) => {
    expect(calculator.calculate(input(points))).toEqual(
      expect.objectContaining({
        periodReturn: null,
        reason: 'ZERO_OR_NEGATIVE_CAPITAL'
      })
    );
  });

  it.each([
    'MISSING_OPENING_VALUE',
    'MISSING_CLOSING_VALUE',
    'INCOMPLETE_VALUATION_INPUT',
    'MISSING_FLOW_VALUE',
    'INVALID_TIMELINE'
  ] as const)('preserves adapter reason %s', (reason) => {
    expect(calculator.calculate(input([], reason))).toEqual(
      expect.objectContaining({ periodReturn: null, reason })
    );
  });

  it('chains repeated tiny decimal returns without binary float accumulation', () => {
    const points = [point('2023-12-31', '1')];
    let value = new Big(1);
    for (let day = 1; day <= 100; day++) {
      value = value.times('1.0000000001');
      points.push(
        point(`2024-04-${String(day).padStart(2, '0')}`, value.toString())
      );
    }
    const result = calculator.calculate(input(points));
    expect(
      new Big(result.periodReturn!).eq(
        new Big('1.0000000001').pow(100).minus(1)
      )
    ).toBe(true);
  });

  it('chains one thousand points in linear order with stable precision', () => {
    const points = [point('2023-12-31', '1')];
    let value = new Big(1);
    for (let day = 1; day <= 1000; day++) {
      value = value.times('1.0001');
      points.push(point(`day-${day}`, value.toString()));
    }
    const result = calculator.calculate(input(points));
    expect(
      new Big(result.periodReturn!).eq(new Big('1.0001').pow(1000).minus(1))
    ).toBe(true);
    expect(result.series).toHaveLength(1001);
  });
});
