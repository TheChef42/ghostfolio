import { XirrCalculator } from './xirr.calculator';
import type { XirrPreparedInput, XirrScheduleEntry } from './xirr.types';

const calculator = new XirrCalculator();

function input(
  schedule: XirrScheduleEntry[],
  preparationReason: XirrPreparedInput['preparationReason'] = null
): XirrPreparedInput {
  return {
    accountingConvention: {
      activityTiming: 'END_OF_DAY',
      opening: 'CLOSE_BEFORE_FROM',
      timezone: 'UTC'
    },
    baseCurrency: 'DKK',
    closingValue: '100',
    coverage: { reasons: [], status: 'COMPLETE' },
    interval: {
      from: '2024-01-01',
      openingDate: schedule[0]?.date ?? '2023-12-31',
      to: schedule.at(-1)?.date ?? '2024-12-30'
    },
    openingValue: '100',
    preparationReason,
    schedule,
    scope: { accountIds: ['a'], identity: 'a', type: 'WHOLE_PORTFOLIO' }
  };
}

function entry(date: string, amount: string): XirrScheduleEntry {
  return { amount, date, sources: ['EXTERNAL_FLOW'] };
}

function referenceBisection(schedule: XirrScheduleEntry[]): number {
  const first = Date.parse(`${schedule[0].date}T00:00:00.000Z`);
  const value = (rate: number) =>
    schedule.reduce((sum, flow) => {
      const days =
        (Date.parse(`${flow.date}T00:00:00.000Z`) - first) / 86_400_000;
      return sum + Number(flow.amount) / Math.pow(1 + rate, days / 365);
    }, 0);
  let lower = -0.999999999;
  let upper = 100;
  for (let index = 0; index < 300; index++) {
    const middle = (lower + upper) / 2;
    if (value(lower) * value(middle) <= 0) {
      upper = middle;
    } else {
      lower = middle;
    }
  }
  return (lower + upper) / 2;
}

describe('XirrCalculator', () => {
  it.each([
    [
      'one-year gain',
      [entry('2024-01-01', '-100'), entry('2024-12-31', '110')],
      0.1
    ],
    ['no gain', [entry('2024-01-01', '-100'), entry('2024-12-31', '100')], 0]
  ])('calculates a simple %s', (_name, schedule, expected) => {
    const result = calculator.calculate(input(schedule));
    expect(result.reason).toBeNull();
    expect(result.annualizedReturn).toBeCloseTo(expected, 9);
    expect(result.normalizedResidual).toBeLessThanOrEqual(1e-10);
  });

  it('annualizes a half-year doubling', () => {
    const schedule = [entry('2024-01-01', '-100'), entry('2024-07-01', '200')];
    const result = calculator.calculate(input(schedule));
    expect(result.annualizedReturn).toBeCloseTo(Math.pow(2, 365 / 182) - 1, 8);
    expect(result.annualizedReturn).toBeGreaterThan(1);
  });

  it.each([
    [
      'mid-period deposit',
      [
        entry('2024-01-01', '-100'),
        entry('2024-07-01', '-50'),
        entry('2024-12-31', '180')
      ]
    ],
    [
      'mid-period withdrawal',
      [
        entry('2024-01-01', '-100'),
        entry('2024-07-01', '40'),
        entry('2024-12-31', '80')
      ]
    ],
    [
      'multiple irregular flows',
      [
        entry('2024-01-01', '-100'),
        entry('2024-03-15', '-30'),
        entry('2024-08-20', '20'),
        entry('2024-12-31', '140')
      ]
    ]
  ])('matches an independent reference for %s', (_name, schedule) => {
    const result = calculator.calculate(input(schedule));
    expect(result.annualizedReturn).toBeCloseTo(
      referenceBisection(schedule),
      8
    );
  });

  it.each([
    [
      'zero duration',
      [entry('2024-01-01', '-100'), entry('2024-01-01', '110')],
      'ZERO_DURATION'
    ],
    [
      'one sign only',
      [entry('2024-01-01', '-100'), entry('2024-12-31', '-10')],
      'ONE_SIGN_ONLY'
    ],
    ['empty schedule', [], 'EMPTY_SCHEDULE']
  ])('returns null for %s', (_name, schedule, reason) => {
    expect(calculator.calculate(input(schedule))).toEqual(
      expect.objectContaining({ annualizedReturn: null, reason })
    );
  });

  it.each([
    'MISSING_OPENING_VALUE',
    'MISSING_CLOSING_VALUE',
    'INCOMPLETE_VALUATION_INPUT'
  ] as const)('preserves adapter reason %s', (reason) => {
    expect(calculator.calculate(input([], reason))).toEqual(
      expect.objectContaining({ annualizedReturn: null, reason })
    );
  });

  it('solves a return close to minus one', () => {
    const result = calculator.calculate(
      input([entry('2024-01-01', '-100'), entry('2024-12-31', '0.0001')])
    );
    expect(result.reason).toBeNull();
    expect(result.annualizedReturn).toBeCloseTo(-0.999999, 8);
  });

  it('solves a very large positive return inside the domain', () => {
    const result = calculator.calculate(
      input([entry('2024-01-01', '-1'), entry('2024-12-31', '10000000000')])
    );
    expect(result.reason).toBeNull();
    expect(result.annualizedReturn).toBeCloseTo(9_999_999_999, -1);
  });

  it('rejects a root beyond the supported domain', () => {
    const result = calculator.calculate(
      input([entry('2024-01-01', '-1'), entry('2024-12-31', '1e30')])
    );
    expect(result).toEqual(
      expect.objectContaining({
        annualizedReturn: null,
        reason: 'NO_VALID_ROOT'
      })
    );
  });

  it('detects a schedule with two roots as ambiguous', () => {
    const result = calculator.calculate(
      input([
        entry('2024-01-01', '-100'),
        entry('2024-12-31', '230'),
        entry('2025-12-31', '-132')
      ])
    );
    expect(result).toEqual(
      expect.objectContaining({
        annualizedReturn: null,
        reason: 'MULTIPLE_ROOTS',
        rootCount: 2,
        signChangeCount: 2
      })
    );
  });

  it('reports no valid root when a non-conventional schedule has no candidate', () => {
    const result = calculator.calculate(
      input([
        entry('2024-01-01', '-100'),
        entry('2024-12-31', '100'),
        entry('2025-12-31', '-100')
      ])
    );
    expect(result).toEqual(
      expect.objectContaining({
        annualizedReturn: null,
        reason: 'NO_VALID_ROOT',
        rootCount: 0
      })
    );
  });

  it('does not infer uniqueness from one non-conventional candidate', () => {
    const result = calculator.calculate(
      input([
        entry('2024-01-01', '-10000000000'),
        entry('2024-12-31', '10000000001'),
        entry('2025-12-31', '-1')
      ])
    );
    expect(result).toEqual(
      expect.objectContaining({
        annualizedReturn: null,
        reason: 'ROOT_UNIQUENESS_NOT_ESTABLISHED',
        rootCount: 1
      })
    );
  });

  it('does not claim convergence for a tangential-root schedule', () => {
    const result = calculator.calculate(
      input([
        entry('2024-01-01', '-100'),
        entry('2024-12-31', '200'),
        entry('2025-12-31', '-100')
      ])
    );
    expect(result.annualizedReturn).toBeNull();
    expect(['ROOT_UNIQUENESS_NOT_ESTABLISHED', 'NO_VALID_ROOT']).toContain(
      result.reason
    );
  });

  it.each([
    ['large scaling', '1000000000'],
    ['tiny scaling', '0.000000001']
  ])('is invariant under %s', (_name, scale) => {
    const base = [entry('2024-01-01', '-100'), entry('2024-12-31', '110')];
    const scaled = base.map((item) =>
      entry(item.date, (Number(item.amount) * Number(scale)).toString())
    );
    expect(calculator.calculate(input(scaled)).annualizedReturn).toBeCloseTo(
      calculator.calculate(input(base)).annualizedReturn!,
      10
    );
  });
});
