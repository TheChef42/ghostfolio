import { Injectable } from '@nestjs/common';
import { Big } from 'big.js';

import {
  XIRR_METHODOLOGY_VERSION,
  XIRR_NORMALIZED_RESIDUAL_TOLERANCE,
  XIRR_SEARCH_DOMAIN,
  XirrPreparedInput,
  XirrResult,
  XirrUnavailableReason
} from './xirr.types';

const DAYS_PER_YEAR = 365;
const MILLISECONDS_PER_DAY = 86_400_000;
const MAXIMUM_ITERATIONS = 200;
const SCAN_INTERVALS = 4096;
const X_TOLERANCE = 1e-12;

interface KernelFlow {
  amount: number;
  years: number;
}

interface KernelValue {
  normalizedResidual: number;
  value: number;
}

interface RootCandidate {
  normalizedResidual: number;
  x: number;
}

@Injectable()
export class XirrCalculator {
  public calculate(input: XirrPreparedInput): XirrResult {
    const signChangeCount = this.signChangeCount(input);

    if (input.preparationReason) {
      return this.result(input, {
        reason: input.preparationReason,
        signChangeCount
      });
    }
    if (input.schedule.length === 0) {
      return this.result(input, { reason: 'EMPTY_SCHEDULE', signChangeCount });
    }

    const firstDay = this.day(input.schedule[0].date);
    const lastDay = this.day(input.schedule.at(-1)!.date);
    if (
      !Number.isFinite(firstDay) ||
      !Number.isFinite(lastDay) ||
      lastDay <= firstDay
    ) {
      return this.result(input, { reason: 'ZERO_DURATION', signChangeCount });
    }
    if (signChangeCount === 0) {
      return this.result(input, { reason: 'ONE_SIGN_ONLY', signChangeCount });
    }

    const kernel = this.toKernel(input, firstDay);
    if (kernel === null) {
      return this.result(input, {
        reason: 'NUMERICAL_OVERFLOW',
        signChangeCount
      });
    }

    const search =
      signChangeCount === 1
        ? this.searchConventional(kernel)
        : this.searchNonConventional(kernel);

    if (search.reason) {
      return this.result(input, {
        reason: search.reason,
        rootCount: search.rootCount,
        signChangeCount
      });
    }

    const candidate = search.candidates[0];
    const annualizedReturn = Math.expm1(candidate.x);
    if (!Number.isFinite(annualizedReturn) || annualizedReturn <= -1) {
      return this.result(input, {
        reason: 'NUMERICAL_OVERFLOW',
        rootCount: 1,
        signChangeCount
      });
    }
    if (candidate.normalizedResidual > XIRR_NORMALIZED_RESIDUAL_TOLERANCE) {
      return this.result(input, {
        reason: 'NUMERICAL_NON_CONVERGENCE',
        rootCount: 1,
        signChangeCount
      });
    }

    return this.result(input, {
      annualizedReturn,
      normalizedResidual: candidate.normalizedResidual,
      reason: null,
      rootCount: 1,
      signChangeCount
    });
  }

  private bisect(
    kernel: KernelFlow[],
    lowerStart: number,
    upperStart: number
  ): RootCandidate | null {
    let lower = lowerStart;
    let upper = upperStart;
    let lowerValue = this.evaluate(kernel, lower);
    let upperValue = this.evaluate(kernel, upper);
    if (!lowerValue || !upperValue || lowerValue.value * upperValue.value > 0) {
      return null;
    }

    let best =
      lowerValue.normalizedResidual < upperValue.normalizedResidual
        ? { normalizedResidual: lowerValue.normalizedResidual, x: lower }
        : { normalizedResidual: upperValue.normalizedResidual, x: upper };

    for (let iteration = 0; iteration < MAXIMUM_ITERATIONS; iteration++) {
      const middle = (lower + upper) / 2;
      const middleValue = this.evaluate(kernel, middle);
      if (!middleValue) {
        return null;
      }
      if (middleValue.normalizedResidual < best.normalizedResidual) {
        best = {
          normalizedResidual: middleValue.normalizedResidual,
          x: middle
        };
      }
      if (
        middleValue.normalizedResidual <= XIRR_NORMALIZED_RESIDUAL_TOLERANCE
      ) {
        return best;
      }
      if (Math.abs(upper - lower) <= X_TOLERANCE) {
        break;
      }

      if (lowerValue.value * middleValue.value <= 0) {
        upper = middle;
        upperValue = middleValue;
      } else {
        lower = middle;
        lowerValue = middleValue;
      }
    }

    return best.normalizedResidual <= XIRR_NORMALIZED_RESIDUAL_TOLERANCE
      ? best
      : null;
  }

  private day(date: string): number {
    return Date.parse(`${date}T00:00:00.000Z`);
  }

  private evaluate(kernel: KernelFlow[], x: number): KernelValue | null {
    const exponents = kernel.map(({ years }) => -x * years);
    const maximumExponent = Math.max(...exponents);
    if (!Number.isFinite(maximumExponent)) {
      return null;
    }

    let absoluteSum = 0;
    let value = 0;
    for (let index = 0; index < kernel.length; index++) {
      const term =
        kernel[index].amount * Math.exp(exponents[index] - maximumExponent);
      if (!Number.isFinite(term)) {
        return null;
      }
      value += term;
      absoluteSum += Math.abs(term);
    }
    if (
      !Number.isFinite(value) ||
      !Number.isFinite(absoluteSum) ||
      absoluteSum === 0
    ) {
      return null;
    }

    return {
      normalizedResidual: Math.abs(value) / absoluteSum,
      value
    };
  }

  private result(
    input: XirrPreparedInput,
    {
      annualizedReturn = null,
      normalizedResidual = null,
      reason,
      rootCount = null,
      signChangeCount
    }: {
      annualizedReturn?: number | null;
      normalizedResidual?: number | null;
      reason: XirrUnavailableReason | null;
      rootCount?: number | null;
      signChangeCount: number;
    }
  ): XirrResult {
    return {
      accountingConvention: input.accountingConvention,
      annualizedReturn,
      baseCurrency: input.baseCurrency,
      closingValue: input.closingValue,
      coverage: input.coverage,
      interval: input.interval,
      method: 'XIRR',
      methodologyVersion: XIRR_METHODOLOGY_VERSION,
      normalizedResidual,
      openingValue: input.openingValue,
      reason,
      rootCount,
      schedule: input.schedule,
      scheduleEntryCount: input.schedule.length,
      scope: input.scope,
      signChangeCount
    };
  }

  private searchConventional(kernel: KernelFlow[]): {
    candidates: RootCandidate[];
    reason: XirrUnavailableReason | null;
    rootCount: number;
  } {
    const lower = this.evaluate(kernel, XIRR_SEARCH_DOMAIN.minimumX);
    const upper = this.evaluate(kernel, XIRR_SEARCH_DOMAIN.maximumX);
    if (!lower || !upper) {
      return { candidates: [], reason: 'NUMERICAL_OVERFLOW', rootCount: 0 };
    }
    if (lower.normalizedResidual <= XIRR_NORMALIZED_RESIDUAL_TOLERANCE) {
      return {
        candidates: [
          {
            normalizedResidual: lower.normalizedResidual,
            x: XIRR_SEARCH_DOMAIN.minimumX
          }
        ],
        reason: null,
        rootCount: 1
      };
    }
    if (upper.normalizedResidual <= XIRR_NORMALIZED_RESIDUAL_TOLERANCE) {
      return {
        candidates: [
          {
            normalizedResidual: upper.normalizedResidual,
            x: XIRR_SEARCH_DOMAIN.maximumX
          }
        ],
        reason: null,
        rootCount: 1
      };
    }
    if (lower.value * upper.value > 0) {
      return { candidates: [], reason: 'NO_VALID_ROOT', rootCount: 0 };
    }

    const candidate = this.bisect(
      kernel,
      XIRR_SEARCH_DOMAIN.minimumX,
      XIRR_SEARCH_DOMAIN.maximumX
    );
    return candidate
      ? { candidates: [candidate], reason: null, rootCount: 1 }
      : { candidates: [], reason: 'NUMERICAL_NON_CONVERGENCE', rootCount: 0 };
  }

  private searchNonConventional(kernel: KernelFlow[]): {
    candidates: RootCandidate[];
    reason: XirrUnavailableReason;
    rootCount: number;
  } {
    const candidates: RootCandidate[] = [];
    const width = XIRR_SEARCH_DOMAIN.maximumX - XIRR_SEARCH_DOMAIN.minimumX;
    let previousX: number = XIRR_SEARCH_DOMAIN.minimumX;
    let previousValue = this.evaluate(kernel, previousX);
    if (!previousValue) {
      return { candidates, reason: 'NUMERICAL_OVERFLOW', rootCount: 0 };
    }

    for (let index = 1; index <= SCAN_INTERVALS; index++) {
      const x = XIRR_SEARCH_DOMAIN.minimumX + (width * index) / SCAN_INTERVALS;
      const value = this.evaluate(kernel, x);
      if (!value) {
        return {
          candidates,
          reason: 'NUMERICAL_OVERFLOW',
          rootCount: candidates.length
        };
      }

      if (value.normalizedResidual <= XIRR_NORMALIZED_RESIDUAL_TOLERANCE) {
        this.addCandidate(candidates, {
          normalizedResidual: value.normalizedResidual,
          x
        });
      } else if (previousValue.value * value.value < 0) {
        const candidate = this.bisect(kernel, previousX, x);
        if (candidate) {
          this.addCandidate(candidates, candidate);
        }
      }
      previousX = x;
      previousValue = value;
    }

    return {
      candidates,
      reason:
        candidates.length === 0
          ? 'NO_VALID_ROOT'
          : candidates.length === 1
            ? 'ROOT_UNIQUENESS_NOT_ESTABLISHED'
            : 'MULTIPLE_ROOTS',
      rootCount: candidates.length
    };
  }

  private addCandidate(
    candidates: RootCandidate[],
    candidate: RootCandidate
  ): void {
    if (candidates.every(({ x }) => Math.abs(x - candidate.x) > 1e-7)) {
      candidates.push(candidate);
    }
  }

  private signChangeCount(input: XirrPreparedInput): number {
    let changes = 0;
    let previousSign = 0;
    for (const { amount } of input.schedule) {
      const sign = new Big(amount).cmp(0);
      if (previousSign !== 0 && sign !== previousSign) {
        changes++;
      }
      previousSign = sign;
    }

    return changes;
  }

  private toKernel(
    input: XirrPreparedInput,
    firstDay: number
  ): KernelFlow[] | null {
    try {
      const amounts = input.schedule.map(({ amount }) => new Big(amount));
      const scale = amounts.reduce(
        (maximum, amount) =>
          amount.abs().gt(maximum) ? amount.abs() : maximum,
        new Big(0)
      );
      if (scale.eq(0)) {
        return null;
      }

      const kernel = input.schedule.map(({ date }, index) => ({
        amount: Number(amounts[index].div(scale).toString()),
        years:
          (this.day(date) - firstDay) / MILLISECONDS_PER_DAY / DAYS_PER_YEAR
      }));
      return kernel.every(
        ({ amount, years }) => Number.isFinite(amount) && Number.isFinite(years)
      )
        ? kernel
        : null;
    } catch {
      return null;
    }
  }
}
