# Phase 2B: external cash-flow management

Phase 2B makes the Phase 1 ledger and Phase 2A import/export contract manageable
from Ghostfolio's existing account experience. It does not add portfolio-return
or valuation calculations.

## Placement and workflow

The ledger appears below the account table on the Accounts page. This location
already owns account scope, account names, write permissions and restricted-view
state, and avoids a second portfolio dashboard. The card explains that external
cash flows are investor capital movements rather than trades or balance snapshots.

Users can filter by account and inclusive accounting-date bounds. Results are
loaded from `GET /api/v1/external-cash-flow` in pages of 100, with server count and
offset pagination. Rows show date, type, owning account, exact native amount,
currency and optional source/comment. No total combines different currencies.
Loading, empty, failure and retry states are explicit, and the table scrolls on
narrow screens without hiding ledger meaning.

## Ordinary flows

The ordinary dialog creates or edits only `DEPOSIT` and `WITHDRAWAL`. It submits
account, `YYYY-MM-DD` date, amount, native currency, source and comment to the
existing ordinary endpoints. Amounts remain strings from input through the HTTP
boundary; the form never converts them to JavaScript numbers. Client validation
matches Decimal(36,18), positive magnitude and metadata lengths for early feedback,
while the backend remains authoritative. The dialog stays open on 400, 404 or 409,
keeps entered data, explains the conflict and prevents duplicate submission.

Ordinary deletion uses Ghostfolio's confirmation dialog and the ordinary delete
endpoint. The ledger reloads only after the backend confirms a mutation.

## Paired transfers

A dedicated dialog presents FROM and TO together. Each side has an account,
accounting date, exact amount and native currency; source/comment are shared.
The client rejects equal accounts, receipt before departure and unequal principals
for equal currencies. Departure and receipt have separate accounting dates: receipt
may be later than departure, and only receipt-before-departure is invalid.
Different-currency principals may differ, and no exchange rate or FX attribution is
inferred.

Storage remains two records. The ledger displays both legs as Transfer out/Transfer
in with a counterpart label. Every edit/delete action is logical-pair scoped and
uses the paired PUT/DELETE endpoint; no UI path calls an ordinary endpoint for a
transfer leg. Deletion confirms that both legs will be removed.

The existing API did not expose a group read. A narrow
`GET /api/v1/external-cash-flow/transfer/:transferGroupId` endpoint was added so an
editor can load both authoritative legs even when account filtering or pagination
hides the counterpart. It reuses account-read scope, ownership lookup, pair
validation and response redaction. Transfer mutation semantics are unchanged.

## Permissions and redaction

The Accounts page derives controls from the same permission/scope combinations as
the API: create-account-balance for create, update-account for edit,
delete-account-balance for delete, plus account-update scope. Restricted views do
not receive controls. Shared/impersonated reads remain server scoped.

The response interceptor remains authoritative for restricted, ZEN and missing
value-read scope. Redacted `amount`, `source` and `comment` stay null; the ledger
shows “Hidden” for value and never reconstructs or caches hidden content. `userId`
and ownership metadata are absent from client contracts.

## Import and export experience

JSON import now forwards the optional version 1 `externalCashFlows` section during
dry run and execution. Preview shows created and idempotently skipped counts returned
by the backend. Backend validation messages, including incomplete or malformed
transfer reports, continue through the existing import error panel. A flows-only
file can proceed when dry run reports rows to create. Legacy files omit the section
and retain the existing activity preview and request behavior.

The export download already receives Phase 2A's optional section transparently, so
no export contract or download code changed.

## Localization and accessibility

All user-facing text uses Angular localization. The repository extractor merged
the new source units into every configured XLF locale. Native Material form fields,
selects, tables, paginator, dialogs and buttons provide labels and keyboard
behavior. Text actions have accessible names, status/error regions use semantic
roles, and destructive confirmation does not rely on color.

## Deferred analytics

No custom date ranges, valuation timeline, Modified Dietz, XIRR, TWR, benchmark,
attribution, drawdown, tax metadata or X-Ray behavior is implemented. A later phase
can consume the unchanged Phase 2A version 1 contract and the explicit ledger.
