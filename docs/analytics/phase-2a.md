# Phase 2A: lossless external cash-flow import/export

Phase 2A extends the existing JSON format without changing its seven legacy
sections. When an export has no external cash flow, `externalCashFlows` is omitted
and the legacy shape remains byte-for-shape compatible.

## Version 1 contract

```json
{
  "externalCashFlows": {
    "version": 1,
    "items": [
      {
        "id": "source-flow-uuid",
        "accountId": "source-account-uuid",
        "date": "2026-01-01",
        "amount": "174200.000000000000000001",
        "currency": "DKK",
        "type": "DEPOSIT | WITHDRAWAL | TRANSFER_IN | TRANSFER_OUT",
        "transferGroupId": null,
        "source": null,
        "comment": null,
        "createdAt": "2026-01-01T12:34:56.789Z",
        "updatedAt": "2026-01-02T12:34:56.789Z"
      }
    ],
    "incompleteTransferGroups": [
      {
        "transferGroupId": "source-group-uuid",
        "reason": "COUNTERPART_OUTSIDE_EXPORT_SCOPE",
        "selectedFlowIds": ["selected-but-omitted-flow-uuid"]
      }
    ]
  }
}
```

`incompleteTransferGroups` is omitted when empty. A malformed stored pair uses
reason `MALFORMED_TRANSFER_PAIR`. No leg from an incomplete group is emitted in
`items`; the section therefore never presents an orphan as importable data. The
importer rejects every section containing an incomplete-group report.

Amounts are positive decimal strings within `Decimal(36,18)`. Dates are accounting
dates and audit timestamps are millisecond UTC ISO strings. The controlled import
path is the only path allowed to supply `createdAt` and `updatedAt`. `userId` is not
part of the contract and is rejected as an unknown field.

## Scope and remapping

Export applies the existing account filter and optional date interval to flows.
Activity-specific filters do not reinterpret flows. When a transfer counterpart
falls outside account/date scope, both legs are omitted and the group is reported.
Accounts referenced by exported flows remain in the account section even if they
have no activities or balances.

Import validates the whole section before legacy data is written. Every source
account must appear in the account section. After the existing account importer
creates or reuses accounts, its source-to-target mapping is applied to each flow.
Ownership is always the authenticated importing user.

Flow ids and transfer group ids are remapped to deterministic, user-bound UUIDs
derived from their source UUIDs with domain-separated SHA-256 input. Both legs of
a source group therefore receive the same new group id, different users receive
different ids, and an exported group cannot select another user's group.

## Atomicity, collision and retry

The entire cash-flow section is inserted by one serializable database transaction;
a failing leg leaves no flow from that section. Complete transfer pairs are
validated before that transaction. Legacy account/activity import retains its
existing transaction boundaries; this phase does not redesign unrelated import
side effects.

An exact retry resolves to the same remapped ids. Existing byte-equivalent
financial/audit content is skipped and reported in the import response. A reused
source id/group with changed content, a partial existing group, or any unexpected
id/group collision fails explicitly and never updates existing rows. A later
export uses the remapped ids as its source identity, so importing that new export
is likewise deterministic.

The import response adds `externalCashFlows: { version, created, skipped }` only
when the optional section was supplied. Dry-run validates/remaps and reports the
prospective created count without writing or emitting portfolio-change events.

## Deferred work

No UI, valuation timeline, performance formula, FX attribution, tax metadata,
benchmark, attribution, drawdown or X-Ray behavior is included. Cross-currency
principals remain exact native amounts without conversion. Phase 2B should consume
this contract when building the valuation timeline and data-quality reporting.
