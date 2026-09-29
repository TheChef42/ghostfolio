# Phase 6: chain-linked TWR

Phase 6 adds a backend-only Time-Weighted Return calculated from the complete
daily Phase 4A valuation timeline. It does not query or reconstruct holdings,
cash, prices, FX, balances or external cash flows.

## Formula and timing

For each UTC accounting day:

`1 + rd = (Vd - CFd) / Vprevious`

The cumulative period return is:

`TWR = product(1 + rd) - 1`

`CFd` uses the Phase 4A portfolio sign directly: deposits are positive and
withdrawals negative. Flows occur at end of day, so they are subtracted from the
closing value before that day's return is calculated. Same-date scope flows are
aggregated with Big.js. Whole-portfolio internal transfers are already neutral;
account-subset transfer legs remain scope flows.

BUY, SELL, dividends, interest and fees are not external flows. Their effect is
already present in the daily valuation and therefore contributes to performance.

## Timeline and index

The adapter requires the opening close immediately before `from`, every daily
close through inclusive `to`, complete valuation coverage and converted flow
amounts. It rejects gaps, reordered boundaries and missing daily values rather
than interpolating.

The calculator uses Big.js with 40 decimal places for subperiod ratios and chain
accumulation. Each funded segment starts with index level `1`. Each API series
point reports date, portfolio value, external flow, subperiod return, chain
factor, index level, segment id and a boundary marker. Contributions and
withdrawals alone do not move the index. TWR is a period return and is not
annualized.

## Funding and segmentation

A first deposit into an empty portfolio establishes a new capital base at that
day's close and receives no return on the funding event. A portfolio reaching
zero ends its funded segment without division by zero. Unfunded points have no
index level.

Later re-funding starts a new segment with index level `1`. Phase 6 calculates
each segment independently and exposes its dates and return, but conservatively
returns a null overall TWR with `UNFUNDED_SEGMENT_BREAK`; it does not invent index
continuity across the gap.

Negative values and value appearing from a zero base without positive external
funding are unsupported.

## Coverage and unavailable results

The period return is null when Phase 4A coverage is not `COMPLETE` or a required
input is unavailable. Reasons are:

- `MISSING_OPENING_VALUE`
- `MISSING_CLOSING_VALUE`
- `INCOMPLETE_VALUATION_INPUT`
- `MISSING_FLOW_VALUE`
- `INVALID_TIMELINE`
- `ZERO_OR_NEGATIVE_CAPITAL`
- `UNFUNDED_SEGMENT_BREAK`

These are valid analytics responses rather than server errors.

## API and compatibility

`GET /api/v1/portfolio/analytics/performance` now accepts `method=TWR` alongside
`MODIFIED_DIETZ` and `XIRR`. The response includes the period return, valuations,
scope, interval, base currency, accounting convention, coverage, reason,
methodology version `phase-6-v1`, segment metadata and the full chain index.

The explicit analytics route is separate from the legacy TWR factory slot, whose
behavior remains unchanged. ROAI, its cache and default method, Modified Dietz,
XIRR, Phase 4A semantics, custom ranges, AccountBalance, ExternalCashFlow and
legacy endpoints are unchanged. This phase adds no schema migration, import or
export behavior, analytics cache, frontend UI or deployment.

Benchmarking, drawdown, decomposition, attribution and frontend charts remain
deferred.
