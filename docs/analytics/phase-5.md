# Phase 5: XIRR

Phase 5 adds a backend-only annualized money-weighted return. XIRR uses the
normalized Phase 4A valuation timeline and does not query or reconstruct raw
portfolio data.

## Schedule and equation

The schedule contains:

1. opening value `-VB` on `interval.openingDate`;
2. each Phase 4A external flow with its sign reversed for the investor
   perspective; and
3. closing value `+VE` on `interval.to`.

A portfolio deposit is therefore a negative investor flow, while a portfolio
withdrawal is positive. BUY, SELL, dividends, fees and neutralized
whole-portfolio transfers are not separate XIRR flows because they are already
reflected in valuation. Account-subset transfer legs remain flows when Phase 4A
classifies them as scope capital.

Amounts on the same accounting date are merged with Big.js, zero totals are
removed, and entries are sorted by UTC date. The solver evaluates:

`sum(Cj / (1 + r)^((dj - d0) / 365)) = 0`, where `r > -1`.

Calendar-day differences use UTC and exactly 365 days per year. The result is an
annualized return and is not converted to a period return.

## Numerical solver

The floating-point kernel is isolated after every amount has been divided by the
largest absolute schedule amount using Big.js. It solves in `x = ln(1 + r)` over
the finite domain `[-20, 50]`, corresponding approximately to rates from
`-0.9999999979` through `5.18e21`.

Conventional schedules with one sign change use their uniqueness property and a
bracketed bisection solver. Bisection is capped at 200 iterations. Non-conventional
schedules are scanned over 4,096 log-rate intervals to identify candidate
brackets, but that finite scan is never treated as proof of uniqueness. Any found
root in a multiple-sign-change schedule is therefore returned as ambiguous; two
validated roots are explicitly counted when detected. A schedule with no
validated candidate in the supported domain returns no root.

NPV evaluation uses exponent shifting to avoid overflow. A candidate is accepted
only when the absolute shifted NPV divided by the sum of absolute shifted terms
is at most `1e-10`. Narrow brackets or exhausted iterations alone do not establish
convergence.

## Coverage and unavailable results

XIRR is null unless Phase 4A coverage is `COMPLETE` and opening, closing and every
converted external flow are available. Undefined schedules return one of:

- `MISSING_OPENING_VALUE`
- `MISSING_CLOSING_VALUE`
- `INCOMPLETE_VALUATION_INPUT`
- `ZERO_DURATION`
- `EMPTY_SCHEDULE`
- `ONE_SIGN_ONLY`
- `NO_VALID_ROOT`
- `ROOT_UNIQUENESS_NOT_ESTABLISHED`
- `MULTIPLE_ROOTS`
- `NUMERICAL_NON_CONVERGENCE`
- `NUMERICAL_OVERFLOW`

These are valid analytics responses rather than server errors.

`MULTIPLE_ROOTS` means that more than one validated root was actually detected.
`ROOT_UNIQUENESS_NOT_ESTABLISHED` means a non-conventional schedule produced one
validated candidate, but the finite search cannot prove that it is unique. Both
cases keep the annualized return null.

## API

`GET /api/v1/portfolio/analytics/performance`

The endpoint now accepts `method=XIRR` alongside `method=MODIFIED_DIETZ`. It
reuses Phase 3 custom or saved interval resolution, Phase 4A account scope, base
currency, authentication and value-access scopes.

The XIRR response includes the annualized return, opening and closing values,
interval, scope, base currency, accounting convention, merged schedule,
schedule-entry count, sign-change count, normalized residual, detected root
count, coverage, unavailable reason and methodology version `phase-5-v1`.

## Compatibility and deferred work

ROAI source, formulas, default selection, response fields and cache behavior are
unchanged. Modified Dietz, Phase 4A timeline semantics, Phase 3 custom ranges,
AccountBalance and ExternalCashFlow semantics are unchanged. No schema migration,
import/export behavior, analytics cache, frontend UI or deployment is added.

TWR, benchmarks, attribution, drawdown and frontend analytics remain deferred.
