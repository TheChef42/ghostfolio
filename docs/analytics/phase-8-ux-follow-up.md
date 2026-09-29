# Phase 8 UX follow-up

Phase 8 now labels each return by meaning and method: **Portfolio return (TWR)** is the selected period's time-weighted return, **Your annualized return (XIRR)** is the investor's annualized money-weighted return, and Modified Dietz remains an explicitly labelled period return. Benchmark return is also a period return for the selected interval.

Click- and keyboard-accessible information controls explain TWR, XIRR, benchmark basis, Modified Dietz, the cash-flow-matched benchmark, and historical-data coverage. The copy distinguishes period and annualized returns, explains cash-flow treatment, and calls out short-period XIRR values and `PRICE_ONLY` or `UNKNOWN` benchmark bases.

The Analysis page also shows a current Core / Satellite allocation snapshot. It reuses the holdings already requested by the page, including the selected account filters, and classifies positive current `valueInBaseCurrency` by the exact tag names `Core` and `Satellite`. Untagged holdings are Other. A holding with both tags is counted once under Other and named in an ambiguity warning. Core and Satellite targets are an isolated client-side 70% / 30% reference; Other has no target. The denominator is the current positive market value of Core, Satellite, and Other holdings, so the selected performance date range does not change this snapshot.

No analytics formulas, API contracts, database schema, legacy ROAI behavior, or backend services changed. The allocation is descriptive only: it does not provide attribution, historical allocation, rebalancing advice, tax or cost modelling, or Phase 9 functionality.
