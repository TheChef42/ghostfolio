# Ghostfolio portfolio analytics: architecture and implementation plan

Prepared 28 September 2026. This is the pre-implementation deliverable. No application code, database, production infrastructure, or deployment has been changed.

## 1. Release and upstream findings

The inspected public production baseline is tag `3.73.0`, commit `6282e39b6bbe9849ba83a0403d2dbf1f5e97b17b`. Upstream `main` resolved during this review to `82cee20f2d4f7a653c088afbc1fd315adf25e9f6` (release 3.74.0). These are pinned research snapshots, not a claim that the private fork or deployed image is identical. The fork location and deployed image digest have not been supplied.

**Recommendation: retain the 3.73.0 base; cherry-pick none of the specified calculator refactors.** Git ancestry checks establish that they are already included:

| Commit     | Change                                                        | Decision            |
| ---------- | ------------------------------------------------------------- | ------------------- |
| `71fc3906` | Performance calculation type in user settings                 | Already in baseline |
| `8529aea2` | Performance calculation type in portfolio snapshot cache keys | Already in baseline |
| `3eec62bc` | Method-independent calculator helpers moved to base class     | Already in baseline |
| `e55f9f0e` | Holding valuation moved to base class                         | Already in baseline |
| `74d564a2` | `timeWeightedInvestment` renamed to `averageInvestment`       | Already in baseline |
| `89da484b` | Percentage formulas moved into method classes                 | Already in baseline |
| `214074a4` | Date-range performance percentage fix                         | Already in baseline |

The existing factory exposes ROAI, ROI, MWR, and TWR. Inspection of the baseline MWR and TWR classes shows that their calculation methods throw “Method not implemented.” Their names must not be mistaken for working money-weighted or chain-linked returns.

The relevant post-baseline calculator change is `30208907` (#7924), dividend performance on the analysis page. Its diff changes both the base calculator and ROAI, expands percentage-method signatures, and adds response fields. Do not cherry-pick it as preparation: it is unnecessary for the proposed architecture and broadens the ROAI compatibility surface. Its tests and design may be consulted without importing its implementation.

There is no reason to rebase this work onto main. Before implementation in the actual fork, inspect its instructions, current branch, working changes, migration history, tag ancestry, and divergence from the pinned baseline. Repeat only the upstream comparison if upstream has moved.

Sources: [3.73.0 release](https://github.com/ghostfolio/ghostfolio/releases/tag/3.73.0), [baseline source](https://github.com/ghostfolio/ghostfolio/tree/6282e39b6bbe9849ba83a0403d2dbf1f5e97b17b), [inspected main](https://github.com/ghostfolio/ghostfolio/tree/82cee20f2d4f7a653c088afbc1fd315adf25e9f6), [dividend change](https://github.com/ghostfolio/ghostfolio/commit/30208907).

## 2. Data-model conflicts and proposed defaults

1. **Cash snapshots are not cash movements.** `AccountBalance` stores dated values, not a complete settlement ledger. The baseline balance service carries balances forward and converts them through its current-rate conversion path. This cannot establish historical daily cash or distinguish a deposit from investment gains. Keep its legacy behavior; add a valuation adapter for the new analytics using original-currency snapshots, recorded movements, and historical FX. Never infer deposits automatically from balance changes.
2. **Cash must be counted once.** Reconstruct cash between known balance anchors from external flows and settled activities. A snapshot is an authoritative balance checkpoint, not another contribution. Reconcile reconstructed and observed balances; unexplained differences make affected results incomplete. Do not add dividends to return a second time if they are already in cash.
3. **Withholding tax is not represented separately.** The baseline activity enum has BUY, SELL, DIVIDEND, FEE, INTEREST, and LIABILITY. Add optional tax and income-basis metadata, without changing existing activity types or ROAI interpretation. Do not assume legacy dividend amounts are gross or net.
4. **Tags overlap and can apply to accounts or activities.** A holding can belong to several tags; cash has no universal per-tag ownership. Ordinary comparisons may overlap and need not sum to portfolio totals. Additive attribution must use a disjoint allocation policy, with explicit weights for overlaps and an Unallocated row. Existing tags remain the only tag taxonomy.
5. **A trade can move capital across an analytical tag boundary.** BUY/SELL remain internal investment activities and never become `ExternalCashFlow` records. For a securities-only tag sleeve, derive separate analytical capital movements between that sleeve and unallocated cash. Otherwise a tagged purchase would falsely appear as a gain. Show this distinction in the API and methodology.
6. **Date-only data cannot recover intraday returns.** Use an explicit end-of-day flow convention for the new calculations, with daily valuations. This produces genuine chain linking under the disclosed convention; it does not claim precision unavailable from the source data.
7. **Incomplete history must be visible.** Missing opening cash, prices, FX, transfer legs, income basis, or sleeve allocation must produce a null metric with a reason where needed, rather than a plausible invented return. Complete historical input is a prerequisite for valid results, not a reason to rewrite old data.

The new analytics value includes selected investments and cash. Existing net-worth/liability reporting stays separate. Unpriced assets or unsupported liability/short exposures receive explicit coverage diagnostics; do not silently omit them from a selected scope.

## 3. Backend design

Keep the ROAI class, formulas, default selection, and legacy response meanings unchanged. Introduce the following services inside the existing portfolio module:

- `PerformanceScopeResolver`: canonical account/tag/exclusion selection, existing tag semantics, and attribution allocation policy.
- `ExternalCashFlowService`: persistence, ownership, transfer validation, scope-aware signed flows, and historical conversion.
- `PortfolioValuationTimelineService`: holdings plus cash, opening anchors, event-day valuations, historical FX, and completeness diagnostics. Reuse existing market-data, split, activity, and FX infrastructure without reusing ROAI percentages as returns.
- Pure calculation modules: Modified Dietz, chain-linked TWR, XIRR, drawdown, decomposition, and benchmark simulation.
- `PortfolioAnalyticsService`: coordinates one immutable, normalized timeline across the selected metrics and benchmarks.

Add `MODIFIED_DIETZ` to the shared calculation type. Implement TWR through the existing TWR method slot using the new timeline. Keep XIRR as a separate annualized metric; do not silently reinterpret the existing MWR placeholder as a chart algorithm. Extend factory inputs with optional analytics context; the ROAI call path must remain unchanged.

New calculations use `Big` for amounts, prices, FX products, weights, ratios, and accumulation. Serialize new monetary values as decimal strings; preserve existing numeric API contracts. Conversions from existing Float columns cannot restore precision already lost, so document this boundary. XIRR's fractional powers require a small isolated floating-point numerical kernel; normalize values, enforce finite results, and validate the residual. Do not replace financial accumulation with float arithmetic.

## 4. Prisma changes

### Migration A: external cash flows

Create `ExternalCashFlowType` with DEPOSIT, WITHDRAWAL, TRANSFER_IN, TRANSFER_OUT, and an `ExternalCashFlow` table:

| Field                | Proposed storage / constraint                                                          |
| -------------------- | -------------------------------------------------------------------------------------- |
| id                   | String UUID primary key                                                                |
| userId               | Required user relation                                                                 |
| accountId            | Required; composite account foreign key `(accountId, userId)` to `Account(id, userId)` |
| date                 | DateTime normalized to the documented accounting date                                  |
| amount               | Decimal(36,18), positive magnitude; SQL check `amount > 0`                             |
| currency             | Required supported currency identifier                                                 |
| type                 | ExternalCashFlowType                                                                   |
| transferGroupId      | Nullable UUID string, scoped to user                                                   |
| source, comment      | Nullable strings with API length limits                                                |
| createdAt, updatedAt | Existing Prisma timestamp conventions                                                  |

Indexes: `(userId, date)`, `(userId, accountId, date)`, `(userId, transferGroupId)`. Add inverse User/Account relations. Prevent cross-user linking in both foreign keys and service validation. Account deletion with cash-flow history should return a conflict until history is explicitly handled; user deletion follows the existing erasure convention.

Transfers are created/updated/deleted as paired operations in one database transaction. Add uniqueness for one incoming and one outgoing leg per non-null `(userId, transferGroupId)` and type; enforce pair completeness, distinct accounts, ownership, and amount/currency consistency in the transactional service. Ordinary deposits/withdrawals have no group. Imports with a deliberately missing counterpart must be reported as incomplete, never silently converted into deposits.

No existing cash-balance table is replaced or duplicated. No historical flows are backfilled automatically.

### Migration B: optional activity tax metadata

Add nullable `Order.withholdingTax Decimal(36,18)` and nullable `Order.incomeAmountBasis` (GROSS or NET). Taxes use the activity currency and must be non-negative. Metadata is valid only on supported income activities. Legacy rows remain null/unknown. An explicitly confirmed zero tax is distinct from unknown.

For new analytics, gross income = recorded income when GROSS, or recorded income plus tax when NET; cash receipt = gross minus tax minus any separately recorded income fee. Keep the original amount and fee fields untouched so legacy ROAI continues interpreting them exactly as before. Prevent a tax from also being classified as an ordinary fee in the new decomposition.

### Settings without extra domain models

Use existing `Settings.settings` JSON for optional saved ranges and generic attribution settings. Saved ranges contain a stable id, name, from date, and either a fixed to date or a dynamic TODAY end. No globally hardcoded dates.

Attribution settings reference existing tag ids, effective dates, and optional allocation weights for overlapping holdings and shared cash. Validate ownership, unique ids, nonnegative weights, and a sum of one for allocated objects. Unassigned fractions go to Unallocated. This is analytical configuration, not a second cash ledger or Core/Satellite model. Store X-Ray rule instances in the existing rule settings structure through a backward-compatible extension.

Migrations are additive. Test upgrade from an empty database and a populated 3.73.0 fixture. Validate schema and generated client. Deploying or rolling back migrations is outside this task; preserve new data if an application rollback is later required.

## 5. Cash flows, transfers, cash, and FX

Store amounts as positive magnitudes. Resolve signed portfolio flows as deposit/incoming positive and withdrawal/outgoing negative. Investor XIRR uses the opposite sign.

Resolve full transfer groups before applying the requested account scope. Both accounts included means zero external flow; only the source included means an outflow; only the destination included means an inflow. A same-currency 174,200 transfer therefore gives -174,200, +174,200, or zero, as requested.

Different settlement dates require a derived in-transit asset for the combined scope so that value does not disappear between legs. Keep it in the outgoing currency until receipt and value it using information available on each date. A transfer pair cannot be netted only within the requested date window: load its counterpart metadata even outside the window. Missing counterpart information is a diagnostic.

For cross-currency transfers, remove both principal legs from total-portfolio external flows by group identity, not by assuming independently converted amounts match. Actual conversion spreads, explicit transfer fees, and FX movements remain performance effects. At a single-account scope, convert the included leg on its own date. Reject inconsistent same-currency pairs unless the difference is explicitly explained by separately recorded expenses.

Load an opening `AccountBalance` anchor per selected account, reconstruct cash from activities and flows, and reconcile later snapshots. Do not interpolate linearly. Trade proceeds, dividends, interest, fees, and taxes change cash but are never investor contributions. Use a single documented settlement/date convention in the absence of settlement timestamps.

Use the historical FX service with a decimal adapter, preserving original values/currencies. Convert every flow at its event date and every asset/cash balance at its valuation date. On non-trading dates use the latest prior available eligible close, with source date and staleness exposed; never look forward. Missing or excessively stale data makes the metric unavailable under an explicit freshness policy. Do not use current FX as a historical fallback.

## 6. Dates and formulas

Custom API dates are strict ISO `YYYY-MM-DD` accounting dates. Expose inclusive from/to to the user; normalize internally to the close before from through the close of to. Include flows on both displayed dates exactly once. Use deterministic UTC calendar-date arithmetic for the new path and return the convention in metadata. Keep named-range behavior unchanged, including its current local-date semantics. A resolver must distinguish legacy named ranges from new explicit bounds rather than silently changing old results.

Reject a mixed named range and explicit dates, inverted bounds, invalid dates, and unsupported future ends. Resolve TODAY once per request and use the same resolved interval for all panels. Read valuation history before from to establish opening holdings/cash, but exclude pre-period flows from period cash-flow totals.

**Modified Dietz:** `R = (VE - VB - sum(CF)) / (VB + sum(w * CF))`, with `w = (end - eventTime) / (end - start)` under the chosen closing-time convention. Include cash in VB and VE. Return null for zero/negative effective capital or a zero-length measurement interval; report the reason.

**TWR:** for each day ending with external flow `CFd`, compute `1 + rd = (Vd - CFd) / Vprevious` and chain `product(1 + rd) - 1`. Both values include cash. Event boundaries are retained even if chart sampling is coarser. Same-day date-only flows are aggregated at the close. A first deposit into an empty portfolio establishes the capital base; it earns no return that day under this convention. Full liquidation ends a segment. Subsequent funding starts a new segment; expose the break rather than inventing growth across an unfunded interval. Zero/negative capital and missing valuations require explicit undefined-result handling.

**XIRR:** solve `sum(Cj / (1+r)^((dj-d0)/365)) = 0`, `r > -1`. Include `-VB` at the beginning for a custom range, reversed-sign external flows during the range, and `+VE` at the end. Without the opening value, custom-range XIRR is wrong. Merge same-date flows and reject zero-duration or one-sign schedules.

Search in transformed log-rate space, bracket candidates, and use safeguarded Brent/bisection with bounded iterations and normalized residual checks. Never rely on Newton alone. Return null for no validated root, non-convergence, overflow, or ambiguity. Conventional one-sign-change schedules permit a uniqueness argument; for nonconventional schedules, a finite scan alone does not prove uniqueness. Require a documented root-isolation/uniqueness check or conservatively return an ambiguity reason. Test multiple roots and tangential roots.

XIRR is annualized even for a short measurement period; label it accordingly. Dietz and TWR are period returns unless the user explicitly selects a separately labelled annualization.

## 7. Benchmarking

Keep existing benchmark endpoints and default charts unchanged. Add explicit `TWR` and `CASH_FLOW_MATCHED` modes to the new analytics comparison endpoint.

For TWR comparison, normalize the portfolio TWR index and benchmark index to the same starting level and calendar. Use a declared total-return benchmark series where available. A price-only series must be labelled as such; do not imply dividend-inclusive comparability or double-count distributions already embedded in adjusted data.

For cash-flow matching, seed benchmark units with VB at the start of a custom interval. Each resolved portfolio inflow buys virtual units at that date's eligible benchmark price converted into the user's base currency; each outflow sells equivalent value. Use exactly the portfolio's normalized scope flow schedule and closing-time convention. Internal transfers have no total-scope effect. Fractional units are allowed; zero or negative prices are invalid.

If a withdrawal exceeds benchmark value, report that the simulation is exhausted rather than silently introduce leverage. Non-trading-date pricing uses the disclosed prior-close convention and never future data.

Return benchmark value, portfolio value, `difference = portfolio - benchmark`, `relativeDifference = difference / benchmark`, and aligned chart series. Relative difference is null at a zero denominator. These values are as of the selected period end, not automatically today's value. Expose benchmark price/total-return basis, FX currency, and data coverage.

## 8. Additive decomposition and tag attribution

Define total absolute return as `VE - VB - sum(external flows)`. Compute daily/event-segment contributions and sum currency amounts across the period; do not sum percentage returns.

For fixed quantity q over a segment, with local prices P and FX X (base currency per local unit):

- Local price contribution: `q * (P1 - P0) * X0`.
- FX contribution: `q * P1 * (X1 - X0)`.

Their sum is exactly `q * (P1*X1 - P0*X0)`. This assigns price/FX interaction to FX. Split segments at quantity-changing trades, using actual trade consideration to reconcile realized/unrealized effects; adjust split quantities consistently with existing split-adjusted market data. Include cash FX gains/losses and documented currency-conversion differences.

The remaining components are gross dividends, interest, negative fees, and negative withholding tax. Convert cash income/expense at event FX; later currency movement on retained cash belongs to FX. Income changes cash and appears in decomposition, but is not added twice to total return.

Validate component sum against independently calculated absolute return using `max(1e-8 base-currency units, 1e-10 * gross absolute component sum)` before display rounding. Report reconciliation residual and coverage. An unexplained snapshot adjustment is not an invented price gain or balancing component; flag an unreconciled result and request correction through normal data editing.

Tag comparison returns current/end value, allocation percentage, Dietz, TWR, absolute P/L, currency contribution to portfolio P/L, and percentage contribution (null when total P/L is zero). Use normal tags. For additive mode, assign each holding/cash contribution once using the allocation policy; complementary sleeve capital movements cancel across sleeves. Include Unallocated unless it is exactly zero. Core + Satellite equals the full portfolio only when they form a complete, disjoint partition. Show overlap clearly in ordinary comparison mode.

Tag edits normally restate historical classification consistently with existing tag behavior. Explicit effective-dated attribution settings enable stable historical allocations; include their revision in cache identity. Never infer historical tag membership from information not recorded.

## 9. Drawdowns and X-Ray

Build drawdowns only from the chain-linked total-return/TWR index. Define `drawdown = index / runningPeak - 1` and expose current drawdown, maximum drawdown, peak date, trough date, first subsequent recovery to the prior peak, and durations in calendar days. Tie policy: retain the earliest peak/trough within an episode. Drawdown duration is peak-to-recovery or peak-to-period-end while unrecovered; recovery duration is trough-to-recovery and remains null if unrecovered, with elapsed recovery time separately available.

Return separate current-episode and maximum-episode details so their dates cannot be confused. Default to a peak baseline within the requested interval and label that choice; an optional inception-peak mode requires pre-range index history. Do not interpolate across unavailable TWR segments or use nominal net worth/ROAI as a fallback.

Extend the existing rule registration, settings, evaluation, and X-Ray presentation with `TagAllocationMinimum` and `TagAllocationMaximum`. Each configurable instance has a stable instance id, tag id, threshold, enabled state, and a declared denominator including cash. Multiple instances of one rule type must be supported without overwriting settings keyed only by the old rule name. Keep old rule keys/settings valid. No hardcoded tag names or 70/30 limits.

Evaluate a tag's union once even if both account and activity membership match. An empty/nonpositive denominator or missing tag gives an unavailable result, not an automatic pass. Add translations and existing permission/redaction behavior.

`InitialPositionSizeMaximum` is optional follow-on work, not a current-weight approximation. Define establishment as the first zero-to-positive position transition in each holding episode, aggregate date-only establishment-day purchases, and evaluate against that day's post-trade portfolio value. Reopening creates a new episode. Missing historical valuation yields unavailable. Price appreciation after establishment must not create a failure. Strategic 5–8/10+ year buckets remain out of scope.

## 10. API and UI contract

Routes below are proposed contracts under Ghostfolio's existing versioned API conventions:

| Area          | Contract                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Cash flows    | Authenticated GET/POST `/external-cash-flow`; GET/PATCH/DELETE by id; paginated date/account filters                               |
| Transfers     | Atomic pair creation/edit/deletion under `/external-cash-flow/transfer`; ordinary single-record updates cannot orphan a pair       |
| Custom dates  | Optional `from`/`to` on performance requests; legacy `range` remains supported                                                     |
| New analytics | New versioned portfolio analytics endpoint accepting method, interval, accounts, tags, exclusions, and attribution policy          |
| Metrics       | Return Dietz/TWR/XIRR, absolute result, valuations, drawdowns, decomposition, chart, quality/reason codes, and methodology version |
| Comparisons   | Benchmark comparison and multi-tag attribution endpoints using the same scope/interval DTO                                         |
| Saved ranges  | Validated settings CRUD with stable range ids and dynamic TODAY support                                                            |

Use a new analytics response type instead of changing the meaning of existing `netPerformance` fields. No method parameter means existing behavior. TWR/Dietz selectors call the explicit new path. New values must obey existing authentication, account ownership, access scopes, shared-portfolio restrictions, ZEN redaction, and subscription behavior where applicable. Tests must verify no leakage through chart, export, or error payloads.

Export adds optional versioned sections for cash flows, transfer links, saved ranges, and attribution settings; tax metadata is optional on activities. Decimal amounts stay strings. Include cash-flow-only accounts even when they have no BUY/SELL activity. Imports without new sections remain valid. Import maps account/tag/group ids consistently, validates all sections before committing, reports incomplete transfer groups in filtered exports, and rolls back atomically on failure. Round trips preserve dates, amounts, currencies, type, transfer identity, source, comments, and cash-flow audit timestamps; bind ownership to the authenticated importing user rather than trusting exported user ids. Define collision/remapping behavior and retry idempotency explicitly.

Add cash-flow management to the existing accounts/activities experience, with paired-transfer editing and import preview. Add custom calendar selection and saved ranges to the shared portfolio filter. Integrate method selection, XIRR, benchmark modes, decomposition, tag comparison, and drawdown panels into Portfolio → Analysis. Add generic rule configuration to existing Portfolio → X-Ray. Use current Angular components, accessibility conventions, locale-aware amounts/dates, client XLF messages, and server rule translations. Do not create another IPS dashboard.

## 11. Affected files

Paths are relative to the target Ghostfolio repository. Existing locations were inspected; files labelled new are proposals.

| Area              | Existing files/directories                                                                                                                                                                                 | Proposed additions                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Schema            | `prisma/schema.prisma`, `prisma/migrations/`                                                                                                                                                               | Two additive migrations described above                                                                                  |
| Cash-flow API     | API root module wiring; existing account/activity permissions and event patterns                                                                                                                           | `apps/api/src/app/external-cash-flow/` module, controller, service, DTOs, unit/integration tests; shared DTOs/interfaces |
| Portfolio         | `apps/api/src/app/portfolio/portfolio.controller.ts`, `portfolio.service.ts`, `portfolio.module.ts`, `get-performance.dto.ts`                                                                              | `analytics/` scope, timeline, orchestration, response mapping and tests                                                  |
| Calculators       | `apps/api/src/app/portfolio/calculator/portfolio-calculator.factory.ts`, `calculator/twr/portfolio-calculator.ts`                                                                                          | `calculator/modified-dietz/`, analytics XIRR/decomposition/drawdown modules; optional context types                      |
| Shared types      | `libs/common/src/lib/types/performance-calculation-type.type.ts`, common portfolio interfaces                                                                                                              | Analytics response/status/convention interfaces; existing ROAI contracts preserved                                       |
| Cash/FX           | `apps/api/src/app/account-balance/account-balance.service.ts`, `apps/api/src/services/exchange-rate-data/exchange-rate-data.service.ts`                                                                    | Separate analytics adapters; existing legacy methods unchanged                                                           |
| Import/export     | `apps/api/src/app/import/import-data.dto.ts`, `import.service.ts`, `import.module.ts`; corresponding export files; `libs/common/src/lib/interfaces/responses/export-response.interface.ts`; `test/import/` | New optional sections, validators, transfer-aware fixtures                                                               |
| Dates/settings    | `apps/api/src/dtos/date-range-filter.dto.ts`, `libs/common/src/lib/calculation-helper.ts`, date-range and user-settings types; existing user settings endpoint                                             | Explicit interval resolver/DTO and saved-range validation                                                                |
| Caches            | `apps/api/src/app/redis-cache/redis-cache.service.ts`, portfolio snapshot queue service, portfolio-change event handlers                                                                                   | Separate analytics cache namespace and invalidation tests                                                                |
| Benchmarks        | `apps/api/src/services/benchmark/benchmark.service.ts`, benchmark endpoints/shared interfaces                                                                                                              | Portfolio-scope simulation service and tests                                                                             |
| Rules             | `apps/api/src/app/portfolio/rules.service.ts`, portfolio rule construction, `apps/api/src/models/rules/rule-settings.ts`, X-Ray rule-key and settings interfaces                                           | `models/rules/tag-allocation/` classes, instance settings, tests                                                         |
| UI                | `apps/client/src/app/pages/portfolio/analysis/`; accounts and activities pages; `apps/client/src/app/components/benchmark-comparator/`; rules component                                                    | Cash-flow dialogs/table; analytics panels, method controls, saved-range controls                                         |
| Shared UI         | `libs/ui/src/lib/portfolio-filter-form/`, `libs/ui/src/lib/services/data.service.ts`, benchmark components                                                                                                 | Date/filter/contract extensions and component tests                                                                      |
| Localization/docs | `apps/client/src/locales/`, existing server translation mechanism                                                                                                                                          | Methodology, migration/data preparation, API examples, limitations, operator notes                                       |

The exact fork may add files to this list. Do not mechanically modify every listed existing file if an adapter preserves compatibility more cleanly.

## 12. Cache identity and invalidation

The baseline snapshot key already includes user, method, and a hash of filters. It does not include explicit range bounds or base currency. Preserve existing ROAI keys/behavior; do not store the new response shape in them.

Use a new analytics namespace keyed by user/access view, base currency, sorted/deduplicated scope, method, resolved interval, time convention, methodology version, attribution revision, benchmark identity/mode/data basis, and input revision. Full-history valuation caches may omit range only if the cached object is demonstrably range-independent; derived result caches must include bounds.

Flow, balance, activity, tax, account, tag, currency/settings, price, and FX changes invalidate relevant new results. Resolve TODAY before key creation. Use the existing portfolio-changed event plus a revision check so an in-flight old calculation cannot repopulate a fresh revision. Preserve existing queue and ROAI behavior. Test filter-order equivalence, range/method/currency separation, and mid-calculation mutation.

## 13. Reviewable commit sequence and verification

Follow the requested order. Each step includes focused tests; frontend capability remains gated until its backend and coverage handling are ready.

1. **Architecture/upstream preparation:** commit this decision record, baseline compatibility fixtures, new contract boundaries, and any necessary test/typecheck target setup. No upstream cherry-picks.
2. **ExternalCashFlow schema/backend/tests:** Migration A, scoped CRUD, atomic transfers, ownership, cash/FX adapter foundations, portfolio-change events.
3. **Import/export and management UI:** optional JSON sections, lossless transfer remapping, flow-only accounts, editing and import preview.
4. **Custom ranges:** deterministic new interval resolver, API/filter state, saved settings, cache interval identity.
5. **Modified Dietz:** complete cash-inclusive valuation timeline, scope flows, numerical and reconciliation tests.
6. **XIRR:** dated flow adapter including opening value, robust solver, independent reference tests, null reasons.
7. **TWR:** event-boundary chain linking, flow timing, segmentation, method integration and index tests.
8. **Cash-flow-matched benchmark:** include TWR comparison here, opening seed, withdrawals, irregular flows, FX and pricing policy.
9. **Total-return decomposition:** Migration B, tax editing/import/export support, gross/net normalization, cash/FX attribution and independent reconciliation.
10. **Tag attribution:** overlap/allocation policy, analytical boundary movements, complete partition reconciliation and coverage display.
11. **Drawdown:** deterministic episode analysis from TWR, durations and recovery states.
12. **Generic X-Ray rules:** multiple tag-rule instances, threshold settings, localization; document optional historical rule separately.
13. **Frontend integration:** Analysis panels, shared selection synchronization, accessibility, permissions/redaction, loading/null states and all locales.
14. **Documentation:** final methodology/API/user documentation, required historical inputs, compatibility evidence, operator migration notes; no deployment.

After each major step run affected Jest suites, Nx lint, TypeScript checks, and relevant API/client builds. The inspected API project has test/lint/build targets but no explicit typecheck target; establish reproducible API/common type checks from the existing tsconfigs and Angular template checking through the client build, rather than claim a nonexistent target ran. Regenerate/validate Prisma after schema changes. Add database integration tests against disposable PostgreSQL, never production. Run the full unchanged ROAI suite at baseline and every calculator/shared-valuation change. Final verification includes full affected API/common/client/UI tests, formatting, lint, typecheck, production build, migrations and import compatibility.

No tests or builds have been run for this research-only deliverable, and no green baseline is claimed.

## 14. Acceptance matrix and fixed examples

| Requested criterion                   | Planned proof                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. No market move, no flow            | VB=VE=100 → Dietz/TWR=0                                                                                                                         |
| 2. Deposit, no move                   | VB=100, deposit=50, VE=150 → 0                                                                                                                  |
| 3. Withdrawal, no move                | VB=100, withdrawal=40, VE=60 → 0                                                                                                                |
| 4–5. Included/single-account transfer | A→B 174,200 → total flow 0; A -174,200; B +174,200                                                                                              |
| 6. Dividend                           | Investment value 100 plus gross dividend cash 5 → total P/L +5; no external flow                                                                |
| 7. Fee                                | Flat assets with fee 2 paid from cash → P/L -2                                                                                                  |
| 8. Withholding                        | Gross dividend 5, tax 1 → P/L +4; income +5 and tax -1 reconcile                                                                                |
| 9. Dietz                              | VB=100, halfway deposit=50, VE=165 → 15/125 = 12%                                                                                               |
| 10. TWR                               | 100→110, then deposit 50 →160, then 176 → 1.1×1.1−1 = 21%                                                                                       |
| 11. XIRR                              | Published Microsoft irregular-date example → 0.373362535 within 1e-8; also one-year -100/+110 →10%                                              |
| 12. Identical benchmark               | Same total-return asset, valuations, opening value and flow schedule → zero difference throughout                                               |
| 13. Irregular benchmark flows         | Prices 10/12/8/11; deposits 100/60/40 at first three dates →20 units and final 220; withdraw 44 at final date →16 units and 176                 |
| 14. Core/Satellite reconciliation     | Complete disjoint allocation → sleeve P/L sum equals portfolio; overlapping and unassigned cases tested separately                              |
| 15. Drawdown                          | Daily index Jan 1–7: 100,120,90,96,120,132,125.4 → max -25% (Jan 2→3), recovery Jan 5, duration 3 days, recovery 2 days; current -5% from Jan 6 |
| 16. Round trip                        | Decimal/string precision, original currencies, paired ids, dates, metadata and audit timestamps preserved through export/import/export          |
| 17. Legacy import                     | All existing accepted fixtures still import without new sections                                                                                |
| 18. Account filter semantics          | Multi-account set permutations, excluded accounts, counterpart beyond window, cross-currency and staggered transfers                            |
| 19. Tag filters                       | Account tags, activity tags, overlaps, shared cash, purchases/sales crossing sleeve boundary, weighted partition and missing allocation         |
| 20. Cache separation                  | Distinct methods/ranges/currencies/benchmark modes; equivalent reordered filters share identity; mutations invalidate correctly                 |

Additional tests cover missing FX, weekends, leap days, DST boundaries, from/to inclusion, same-day inflow/outflow, zero/negative capital, full liquidation/re-entry, short positions, missing opening snapshots, stock splits, benchmark exhaustion, unknown gross/net income, duplicate imports, cross-user ids, simultaneous transfer edits, and redacted/shared responses.

XIRR reference data: -10,000 on 2008-01-01; +2,750 on 2008-03-01; +4,250 on 2008-10-30; +3,250 on 2009-02-15; +2,750 on 2009-04-01. This is an independent solver fixture; separate tests exercise the portfolio flow-sign/opening-value adapter. Source: [Microsoft XIRR documentation](https://support.microsoft.com/en-us/Excel/functions/xirr-function).

## 15. Implementation readiness

The architecture review is complete. Before editing the user's fork, its repository path or remote and intended working branch are needed; a public upstream research clone is not a substitute for the fork. Confirm production's actual revision through supplied deployment metadata if available, without changing infrastructure. Use the defaults above as the proposed implementation contract and record any fork-specific differences before the first code commit.

Do not deploy automatically. No changes to ROAI, duplicate cash balances, duplicate Core/Satellite models, duplicate IPS dashboards, or strategic time-bucket models are proposed.
