# Phase 4A: portfolio valuation timeline

Phase 4A adds a separate, normalized valuation foundation at
`GET /api/v1/portfolio/analytics/valuation`. It does not alter legacy portfolio
responses or calculate Modified Dietz, XIRR, TWR, benchmarks, attribution or
drawdowns.

## Scope and interval

The endpoint requires portfolio value-read access and a Phase 3 custom interval.
It supports the whole non-excluded portfolio or an explicit owned account subset.
Account ids are deduplicated and sorted to form a deterministic scope identity.

Dates are UTC accounting dates. The opening valuation is the close immediately
before the inclusive `from` date; the closing valuation is the inclusive `to`
date close. Date-only activities and flows take effect at end of day. The canonical
timeline contains the opening boundary and every calendar-day close through the
closing boundary, without chart downsampling.

## Holdings and cash

Holdings are reconstructed from BUY and SELL activities using the existing split
convention: historical activities are adjusted while provider market data remains
split-adjusted. Each valued holding reports quantity, instrument currency, price,
price source date, FX, FX source date and base-currency value. Liabilities, shorts
and unpriced assets remain visible through coverage diagnostics.

`AccountBalance` rows are authoritative cash checkpoints, never deposits or
withdrawals. Each account needs an opening checkpoint at or before the opening
boundary. Cash is replayed from it using trade consideration, dividends, interest,
fees and the explicit `ExternalCashFlow` ledger. A later checkpoint is compared
with reconstructed cash using a technical tolerance of `0.00000001` native units.
A mismatch is reported, creates no synthetic flow and uses the observed checkpoint
as the next reconstruction anchor.

Complete transfer groups are resolved before account scope is applied. Both legs
inside scope are external-flow neutral by group identity, including cross-currency
pairs. A single included leg remains a signed scope flow. Transfer legs still move
cash between their actual accounts.

## Historical data and coverage

Prices and FX use the same-day close or latest prior `CLOSE` row. Future data and
current-rate fallback are forbidden. The default freshness limit is seven calendar
days; the requested date, actual source date and staleness are returned. Direct,
inverse and base-currency-cross FX pairs are supported.

Coverage is `COMPLETE`, `INCOMPLETE` or `UNAVAILABLE`. Structured reasons include
missing opening cash, missing or stale prices/FX, reconciliation mismatches,
malformed transfer pairs and unsupported assets/liabilities/shorts. A missing
opening or closing component makes the result unavailable instead of assuming zero
or silently omitting an asset.

## Cache and compatibility

Phase 4A adds no cache. This avoids stale derived results while the input-revision
contract is still being established. A future cache must include access view, base
currency, canonical scope, resolved interval, methodology version and input
revision. Existing ROAI caches and formulas remain untouched.

No schema migration or persisted balancing data is introduced. AccountBalance,
ExternalCashFlow, import/export, named ranges and Phase 3 custom-range semantics
remain unchanged. Modified Dietz and all later analytics methods are intentionally
deferred.
