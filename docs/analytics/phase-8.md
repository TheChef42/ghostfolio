# Phase 8: analytics frontend

Phase 8 presents the existing analytics APIs inside Ghostfolio's established
Portfolio → Analysis page. It keeps the existing page shell, filters, benchmark
setting, cards, typography, spacing and chart component; it does not introduce a
separate analytics dashboard.

## Performance hierarchy

The overview leads with chain-linked TWR as **Portfolio return** for the selected
period. XIRR appears beside it as **Your annualized return**, so its annualized
money-weighted meaning is not confused with a period return. The selected
benchmark's TWR period return and the resolved interval complete the summary.

The existing benchmark comparator renders the Phase 7 aligned portfolio and
benchmark indices. Both begin at the same level. A visible legend, distinct line
styles and an accessible chart label identify the series without relying on color
alone. PRICE_ONLY and UNKNOWN benchmark bases are disclosed without hiding an
otherwise available comparison.

Modified Dietz and the cash-flow-matched benchmark simulation live in a collapsed
**Advanced analysis** panel. Opening value, closing value, external flows and data
quality details remain available there without competing with the primary TWR and
XIRR results.

## Shared scope and request behavior

All analytics requests reuse the current Ghostfolio date range, saved/custom
interval, account filters and base currency. Account filters define the portfolio
scope; unrelated UI filters are not sent as analytics scope. Changing the shared
selection refreshes TWR, XIRR and benchmark comparison together. Modified Dietz
and cash-flow matching load only after the advanced panel is opened. Request
switching cancels stale observable chains so a slower prior response cannot replace
the current selection.

## Loading, empty and unavailable states

Summary cards and the existing comparison chart preserve their layout while data
loads. A missing benchmark produces a selection prompt rather than a fabricated
comparison. API failures are shown separately from financially unavailable
results. Incomplete valuation, stale or missing historical market data, unsupported
capital states and ambiguous XIRR schedules produce concise user messages and a
null display; unavailable values are never presented as zero. Complete coverage
does not add warning noise.

## API and compatibility

The client uses the explicit analytics endpoints:

- `GET /api/v1/portfolio/analytics/performance` with `MODIFIED_DIETZ`, `XIRR` or
  `TWR`
- `GET /api/v1/portfolio/analytics/benchmark` with `TWR` or
  `CASH_FLOW_MATCHED`

Shared TypeScript contracts model the method-specific responses and structured
coverage returned by Phases 4B–7. No calculation, valuation, price, FX, flow or
benchmark semantics are implemented in the browser.

Existing Analysis sections for absolute performance, top and bottom positions,
portfolio evolution, investments and dividends remain on the page. ROAI, Modified
Dietz, XIRR, TWR, benchmark calculations, custom ranges, AccountBalance,
ExternalCashFlow, legacy endpoints, imports and exports are unchanged. Phase 8
adds no schema migration, persistent cache, decomposition, attribution, drawdown,
X-Ray or deployment.
