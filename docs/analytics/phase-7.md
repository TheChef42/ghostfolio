# Phase 7: benchmark comparison

Phase 7 adds backend-only benchmark analytics under
`GET /api/v1/portfolio/analytics/benchmark`. The selected benchmark is explicit
(`dataSource` and `symbol`) and must be one of Ghostfolio's configured benchmark
profiles. Existing benchmark endpoints, settings and charts remain unchanged.

## Identity, basis and historical valuation

Responses preserve the benchmark id, symbol, data source, display name, native
currency and return basis. A declared basis is `TOTAL_RETURN` or `PRICE_ONLY`.
Ghostfolio's current symbol profile schema does not declare this distinction, so
the API conservatively reports `UNKNOWN` with an `UNKNOWN_RETURN_BASIS` warning
instead of guessing. An unknown basis does not itself prevent calculation.

Benchmark prices use the Phase 4A policy: same-day eligible close or latest prior
close, never future data or a current-price fallback. Historical FX converts each
price into the portfolio base currency on the corresponding economic date, with
no current-FX fallback. Requested date, source date and staleness are retained.
The Phase 4A seven-calendar-day freshness limit applies to price and FX inputs.

## TWR comparison

`mode=TWR` reuses the Phase 6 portfolio TWR index and its complete daily calendar.
The benchmark index is its converted close divided by its opening converted close,
so both indices start at `1`. Portfolio cash flows are not applied to this index.
Non-trading days carry the latest eligible prior close and remain in the aligned
series. A Phase 6 `UNFUNDED_SEGMENT_BREAK` makes the comparison unavailable rather
than inventing continuity.

## Cash-flow-matched simulation

`mode=CASH_FLOW_MATCHED` seeds fractional benchmark units with the Phase 4A opening
portfolio value divided by the converted benchmark price at the opening boundary.
Every normalized positive scope flow buys units and every negative scope flow sells
units at the eligible end-of-day benchmark close. Whole-portfolio internal
transfers are already neutral in Phase 4A; an included single-account leg remains
a simulated flow. BUY, SELL, distributions and fees are not benchmark trades.

Units, FX conversion, benchmark values and differences use Big.js with 40 decimal
places. A withdrawal that would make units negative stops the simulation with
`BENCHMARK_SIMULATION_EXHAUSTED`; leverage is never introduced. The endpoint
returns closing portfolio and benchmark values, `difference = portfolio - benchmark`
and `relativeDifference = difference / benchmark`. Relative difference is null
when benchmark value is zero.

## Coverage and API

Benchmark coverage is separate from portfolio coverage and reports missing, stale
or invalid price/FX inputs, unsupported benchmark identity, unknown basis and
simulation exhaustion. Financially unavailable comparisons return null values and
an explicit reason rather than failing the request.

The versioned endpoint accepts the Phase 3 custom or saved interval, account scope,
base currency, explicit benchmark identity and `TWR` or `CASH_FLOW_MATCHED` mode.
It returns methodology version `phase-7-v1`, UTC end-of-day accounting convention,
both coverage objects, aligned diagnostics and the mode-specific result. There is
no persistent analytics cache; unique dates are resolved once per request.

ROAI, Modified Dietz, XIRR, portfolio TWR, Phase 4A valuation, custom ranges,
AccountBalance, ExternalCashFlow, imports, exports and legacy benchmark behavior
are unchanged. This phase adds no schema migration, frontend UI, decomposition,
attribution, drawdown or deployment.
