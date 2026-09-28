# Phase 1: external cash-flow foundation

Base: upstream `3.73.0`, `6282e39b6bbe9849ba83a0403d2dbf1f5e97b17b`.
Branch: `analytics-foundation`. Origin is `TheChef42/ghostfolio`; upstream is
`ghostfolio/ghostfolio`. At inspection both main branches were at `82cee20f`,
10 upstream commits after the baseline, with no fork-only changes.

The [architecture](architecture-2026-09-28.md) is binding. This phase implements
only cash-flow persistence, authenticated CRUD, paired transfers, scope resolution,
events, and tests. No calculators, FX attribution, import/export additions, UI,
tax metadata, deployment, or merge are included.

Repository guidance: no root AGENTS.md; `.agents/skills/nestjs-best-practices`
and `.agents/skills/karpathy-guidelines` describe Nest modules, input validation,
guards, transactions, focused changes, and tests. Use the repository's Prisma
conventions rather than the TypeORM examples in the generic Nest guide.

Baseline verification before edits: `npm ci` with Node 24.19.0 succeeded.
`node --env-file=.env.example node_modules/nx/dist/bin/nx.js test api --runInBand
--skipNxCache` passed 53 suites / 248 tests, with one existing skipped test.
NX_DAEMON and NX_ISOLATE_PLUGINS were false. The direct dotenv-cli invocation was
unavailable; Nx 23's entry point is `dist/bin/nx.js`. No test failure was observed.
The complete existing migration history applied to disposable PostgreSQL 16.

## Contract

Amounts are positive decimal strings (at most 18 integer and 18 fractional digits).
Negative signs belong to scope resolution, not storage. Currency validation uses
Ghostfolio's existing supported-currency validator. Accounting dates are strict
YYYY-MM-DD, stored at UTC midnight. Collection date bounds are inclusive.

An external flow records capital movement only. It never changes AccountBalance,
creates an activity, infers a deposit from a balance, or invokes ROAI. The legacy
`account/transfer-balance` endpoint remains unchanged and does not create flows.
Users must avoid recording the same movement twice in the new ledger.

Transfers use two independently specified legs (account, date, currency, amount)
and a server-generated group UUID. Same-currency principals must be equal.
Cross-currency principals can differ: this phase stores them without converting
or attributing FX. Source and destination accounts must differ and belong to the
same authenticated effective user. Receipt cannot precede departure.

Transfers are mutated only as pairs in serializable transactions. Ordinary PATCH
or DELETE rejects either leg. Group ids and ownership cannot be supplied/changed
through ordinary inputs. Database constraints enforce positive amounts, valid
group/type combinations and one leg of each type per user/group; the service
validates complete pairs. A malformed historical group is a conflict, never
silently repaired. Conflicting concurrent writes return a retryable conflict.

Account deletion with flow history returns 409. The composite account foreign key
also prevents deletion races. User erasure remains possible through cascading
user deletion; the account FK is deferred NO ACTION rather than immediate RESTRICT.

The resolver validates whole pairs before applying the selected account/date
scope. Both accounts included means neither principal is an external flow, even
when only one leg falls in the date interval. One included account produces its
signed leg. Currencies are retained; amounts in different currencies are never
summed. Missing or duplicate legs and cross-user input are reported explicitly.
Later valuation code must account separately for cash in transit across dates.

Events use the existing PortfolioChangedEvent, emitted once after each successful
mutation commits, never on rollback. Existing ROAI cache behavior is untouched.

## API surface

All routes are below the existing `/api/v1` prefix and use Ghostfolio's JWT,
impersonation, permission and account-scope guards.

| Method | Route                                           | Meaning                                                                     |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------------- |
| GET    | `/external-cash-flow`                           | Owned collection; optional `accounts`, `from`, `to`, `skip`, `take` filters |
| GET    | `/external-cash-flow/:id`                       | One owned flow                                                              |
| POST   | `/external-cash-flow`                           | Create a `DEPOSIT` or `WITHDRAWAL`                                          |
| PATCH  | `/external-cash-flow/:id`                       | Partially update an ordinary flow                                           |
| DELETE | `/external-cash-flow/:id`                       | Delete an ordinary flow                                                     |
| POST   | `/external-cash-flow/transfer`                  | Atomically create both transfer legs                                        |
| PUT    | `/external-cash-flow/transfer/:transferGroupId` | Atomically replace both legs while preserving their ids                     |
| DELETE | `/external-cash-flow/transfer/:transferGroupId` | Atomically delete both legs                                                 |

The collection defaults to `skip=0`, `take=100`, with `take<=500`. A foreign id
or account returns 404 so ownership cannot be inferred. Responses omit `userId`
and preserve decimal values as strings. Amount, source and comment are redacted
for ZEN, restricted, or shared views without `portfolioReadValues`.

An ordinary request contains `accountId`, `date`, `amount`, `currency`, `type`,
and optional `source`/`comment`. A transfer request contains `from` and `to` legs,
each with account/date/amount/currency, plus optional shared source/comment. The
server supplies ownership, ids, timestamps and transferGroupId.

## Migration and verification

Migration `20260928000000_added_external_cash_flow` adds the enum, table, checks,
indexes and relations without modifying historical rows. It was applied to both
an empty database and a separately populated 3.73.0 database on disposable
PostgreSQL 16. The populated fixture retained its synthetic user, account,
balance, order and asset profile and contained zero invented external flows.

The real-database integration suite uses only a URL supplied via
`CASH_FLOW_TEST_DATABASE_URL`, rejects non-local or non-`phase1_` databases, and
injects failures on the second transfer leg to prove create, update and delete
rollback behavior. Unit/HTTP coverage also checks exact decimal boundaries,
ownership, authorization and redaction, resolver cancellation, legacy imports,
and the unchanged legacy export shape.

The repository has no API typecheck target. Verification therefore uses
`tsc --noEmit -p apps/api/tsconfig.app.json`, the real Nx API build, API lint,
Prisma validate/generate, focused tests and the complete API Jest suite.

## Phase 2 import/export requirements

Current exports/imports remain unchanged and DO NOT back up the new flow ledger.
Phase 2 must add an optional versioned externalCashFlows section; preserve exact
decimal strings, dates, currencies, direction, source, comment and audit timestamps;
remap account ids and transferGroupId consistently; assign importing ownership on
the server; validate both legs before writing; define collision/retry behavior;
include accounts with only flows; report incomplete filtered-export pairs; and
prove lossless round trips plus compatibility with every legacy accepted fixture.
Do not treat today's legacy export as a complete backup of new cash-flow data.
