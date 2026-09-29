# Phase 4B: Modified Dietz

Phase 4B adds a backend-only Modified Dietz period return. The pure calculator
consumes the Phase 4A `PortfolioValuationTimeline`; it does not query Prisma,
market data, balances, activities, prices, FX or external cash flows itself.

## Calculation

The calculation is:

`R = (VE - VB - sum(CF)) / (VB + sum(w * CF))`

`VB` and `VE` are the cash-inclusive opening and closing values from Phase 4A.
External flows retain the Phase 4A sign convention: capital entering scope is
positive and capital leaving scope is negative. Internal whole-portfolio
transfers are already absent from the normalized flow schedule; a transfer leg
crossing an account-subset boundary remains a signed scope flow.

The response also reports `absoluteResult = VE - VB - sum(CF)`. This diagnostic
is distinct from every legacy ROAI profit/loss field.

All financial arithmetic uses an isolated Big.js constructor with 40 decimal
places for division. Monetary inputs, intermediates and response diagnostics are
decimal strings.

## Timing convention

The economic start is UTC end-of-day on `interval.openingDate`, immediately
before the inclusive `from` date. The end is UTC end-of-day on `interval.to`.
A date-only external flow occurs at UTC end-of-day on its accounting date, and:

`w = (end - flowTime) / (end - start)`

For `openingDate=2023-12-31`, `from=2024-01-01`, and `to=2024-01-10`, a flow on
January 1 has weight `0.9`, a January 5 flow has weight `0.5`, and a January 10
flow has weight `0`. Same-date flows may be summed independently because the
weighted sum is additive.

## Coverage and undefined results

The period return is null unless Phase 4A coverage is `COMPLETE`. Phase 4A
coverage status and reasons are returned unchanged. Partial values never produce
a plausible return. The response supplies one of these reasons when unavailable:

- `MISSING_OPENING_VALUE`
- `MISSING_CLOSING_VALUE`
- `INCOMPLETE_VALUATION_INPUT`
- `ZERO_LENGTH_INTERVAL`
- `ZERO_EFFECTIVE_CAPITAL`
- `NEGATIVE_EFFECTIVE_CAPITAL`

These financial undefined cases are valid API responses and do not raise server
errors.

## API

`GET /api/v1/portfolio/analytics/performance`

The request requires `method=MODIFIED_DIETZ`, a Phase 3 custom or saved interval,
the authenticated portfolio scope, optional account scope, and optional base
currency. It requires both portfolio read and monetary-value scopes. Asset class,
symbol, tag and data-source filters are rejected because the Phase 4A timeline
currently supports portfolio and account scopes.

The response includes method, period return, absolute result, opening and closing
values, total and weighted external flow, effective capital, interval, accounting
convention, base currency, scope, coverage, unavailable reason, and methodology
version `phase-4b-v1`.

## Compatibility and deferred work

The legacy ROAI source, formula, response fields, default method and cache path are
unchanged. Phase 3 interval resolution and Phase 4A timeline, AccountBalance and
ExternalCashFlow semantics are reused without modification. This phase adds no
schema migration, import/export behavior, client UI, cache or deployment.

XIRR, TWR, benchmarks, attribution and drawdown remain deferred.
