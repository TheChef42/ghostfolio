# Phase 8 analytics performance follow-up

## Measured root causes

The initial Analysis view requests legacy portfolio performance, current holdings,
dividends and investments. The analytics overview additionally starts TWR, XIRR
and TWR benchmark requests concurrently. Before this change, each analytics
request independently loaded accounts, balances, external flows and activities,
then reconstructed and retained its own daily valuation timeline. Benchmark
analytics called the same timeline service again.

Historical valuation memoized only an exact symbol/date or currency/date request
inside one build. A position held for a year still produced a lookup for every
valuation date. Coverage-reason deduplication also scanned the complete reason
array for every new reason, producing quadratic behavior for long incomplete
timelines.

The frontend did not issue duplicate identical calls during one stable change
detection pass, but any equivalent input object change refreshed the complete
TWR/XIRR/benchmark group. A benchmark-only change also refreshed portfolio
metrics. Core / Satellite was already isolated: it derives a current snapshot
from the existing holdings request and never calls historical analytics.

## Request graph

Initial analytics graph before this change:

```text
Analysis overview
|- GET analytics/performance?method=TWR ------------> build timeline A
|- GET analytics/performance?method=XIRR -----------> build timeline B
`- GET analytics/benchmark?mode=TWR ----------------> build timeline C
                                                     + benchmark series

Advanced analysis when opened
|- GET analytics/performance?method=MODIFIED_DIETZ -> build timeline D
`- GET analytics/benchmark?mode=CASH_FLOW_MATCHED --> build timeline E
                                                     + benchmark series
```

After this change:

```text
TWR -----------\
XIRR -----------+--> canonical key --> MISS + COALESCED --> one input load
TWR benchmark -/                                           one market-data batch
                                                           one timeline
                                                           shared read-only result

Advanced Dietz -------------------------------> timeline HIT
Cash-flow-matched benchmark ------------------> timeline HIT + benchmark-series HIT
```

The HTTP contracts remain separate. The backend coalesces identical concurrent
work and returns the same canonical timeline object to the metric-specific pure
calculators.

## Cache and execution context

The timeline identity contains user, sorted and deduplicated requested account
scope, base currency, resolved dates, UTC convention, methodology version, a
per-user portfolio generation and the process market-data revision. Benchmark
identity is intentionally absent.

The process-local timeline cache has a 30-second TTL and at most eight entries.
It shares in-progress promises, removes failed promises, and does not allow work
started before an invalidation to repopulate the cache. Portfolio change events
advance the affected user's generation. Market-data writes advance a global
process revision, covering historical price and FX changes. Metric results and
prepared benchmark series use `WeakMap` caches tied to the canonical timeline,
so they cannot outlive it. No persistent Redis analytics-result cache was added.

Historical prices and FX are prepared as deduplicated identifiers. One bounded
series query loads the freshness window and requested interval; one prior row per
identifier preserves the exact stale-versus-missing diagnostic and prior-close
policy. Daily resolution then uses binary search in memory. Zero-value and
zero-quantity gates still run before resolution.

## Synthetic measurement

The reproducible fixture uses five accounts, 200 activities, 20 securities,
three currencies, opening balance checkpoints, 12 external flows and 366 daily
points. It warms up once and averages three cold Analysis loads, each with three
concurrent timeline consumers.

| Measurement                                |           Before |           After |
| ------------------------------------------ | ---------------: | --------------: |
| Timeline builds                            |                3 |               1 |
| Portfolio database query groups            |               18 |               5 |
| Historical price/FX datastore lookup model |           25,866 |              27 |
| Mean wall-clock time                       |        169.19 ms |       103.52 ms |
| Approximate mean heap delta                | 11,875,872 bytes | 2,888,120 bytes |

The baseline resolver model treats each logical price or FX resolution as one
datastore lookup. The optimized measurement runs the bounded-series adapter and
loads 26 unique market identifiers with 27 datastore calls: one range query plus
one prior-close query per identifier. Heap figures are Jest-process deltas and
show direction rather than a production RSS guarantee.

## Frontend behavior

Portfolio request identity includes base currency, date selection and canonical
account scope. Benchmark identity is tracked separately. Equivalent account
orders and unrelated filters do not refetch analytics. Changing only benchmark
selection refreshes TWR benchmark and, when already opened, cash-flow matching;
it does not refetch TWR, XIRR or Modified Dietz. Advanced Analysis remains lazy
and reopening it with unchanged inputs does not refetch.

## Observability and limitations

Debug-level logs expose timeline cache state, counts and database/build/total
timings, bounded market-data query timing, and metric compute timing. They do not
contain user identifiers, account identifiers or financial values.

The cache and in-flight map are process-local. A deployment with multiple Node
processes coalesces only within each process. The existing page's legacy
portfolio-performance chart remains a separate calculation path because reusing
the new timeline would change legacy ROAI behavior. Dividends and investment
timeline endpoints also remain separate. The canonical daily timeline is still
retained once because TWR, charts and diagnostics require its points.

All valuation coverage rules, cash reconciliation tolerance, holding episodes,
opening-cash inference, account isolation, benchmark isolation, formulas, flow
signs, transfer cancellation and UTC end-of-day semantics remain unchanged.
