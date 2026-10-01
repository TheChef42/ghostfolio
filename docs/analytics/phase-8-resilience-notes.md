# Phase 8 analytics resilience notes

## Current behavior before this follow-up

- `PortfolioValuationTimelineService` is the single valuation source for Modified Dietz, TWR, XIRR, and benchmark analytics. It reconstructs native-account cash from `AccountBalance` anchors, activities, and scoped `ExternalCashFlow` rows, then converts required values with the historical resolver.
- Cash checkpoint reconciliation currently uses decimal-safe `Big` arithmetic but accepts only an absolute residual of `0.00000001`. Any larger residual creates `CASH_RECONCILIATION_MISMATCH`; because timeline coverage treats every reason as incomplete, all three portfolio return methods become unavailable.
- Holdings are updated from scoped BUY/SELL activity before each end-of-day valuation. The valuation loop already skips exact zero quantities, so price and holding-currency FX resolution should occur only on dates with a non-zero position. Focused episode tests are missing, so this contract is not protected against regressions.
- Historical prices and FX use same-day or prior eligible closes, reject sources older than seven days, and never use future or current-value fallback. Missing/stale sources add timeline coverage reasons.
- An account without an `AccountBalance` at or before the opening boundary always receives `MISSING_OPENING_CASH`, even when the imported history proves that its first economic event is a later explicit funding flow.
- Portfolio and benchmark coverage are represented separately in benchmark results. The standalone portfolio performance services do not query benchmark data, but focused regression coverage for this independence is limited.
- The calculator formulas and flow semantics live downstream of the timeline: Modified Dietz consumes the timeline directly, while TWR and XIRR use pure adapters and calculators. This follow-up must change timeline evidence and diagnostics only.

## Intended follow-up

Introduce native-currency minor-unit reconciliation tolerance, explicit inferred-zero opening provenance, richer scoped diagnostics, and regression coverage for holding episodes and independent benchmark failures. Historical lookup, freshness, calculation formulas, transfer handling, and legacy ROAI remain unchanged.
