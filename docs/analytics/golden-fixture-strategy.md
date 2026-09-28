# Future Nordnet/Saxo acceptance fixture

No investor data is included in Phase 1. All current tests are synthetic.

Prepare an opt-in fixture from copies of broker exports, never live credentials or
production databases. Keep originals outside Git and record the broker export
format/version. Reconcile opening and ending holdings and cash per account and
currency against the source statements before sanitizing.

## Sanitization with economic invariants

- Replace names, account numbers, customer ids, broker record ids, addresses,
  emails, tax identifiers and transfer references with random stable fixture ids.
  Keep the identity map privately outside the fixture. Remove free-text comments,
  filenames, document metadata, embedded links and source fields that disclose
  personal information. Use neutral account names such as ACCOUNT_A.
- Preserve transaction dates, order/flow types and same-day grouping. Shifting
  dates can change weekends, FX, splits, cash-flow weights and inception periods;
  do not shift dates independently of the entire historical-data fixture.
- Preserve currencies and the original precision. Retain amounts and quantities
  where needed for reconciliation. If amounts must be anonymized, scale all cash,
  quantities, balances, income, expenses and benchmark seeds by the same documented
  positive rational factor; retain prices/FX. Recompute absolute expected results.
  Do not scale individual accounts independently or round away small fees.
- Preserve stock split ratios, quantity adjustments and price adjustment basis.
  Do not anonymize security identifiers without a consistent replacement in
  prices, corporate actions, currencies and expected holdings.
- Keep each transfer's two legs, dates, native currencies and principal amounts
  linked through a remapped group id. Preserve settlement gaps. Mask shared bank
  references without destroying pair linkage.
- Keep dividends and interest separate from investor deposits. Keep fees separate
  from withdrawals. When tax metadata exists, retain gross/net basis and explicit
  withholding amounts, including unknown versus confirmed zero.
- Include the necessary historical price/FX series locally with provenance and
  redistribution permission. Acceptance tests must not depend on changing live
  quotes or today's date.

Exact dates and economic amounts can themselves identify a portfolio. Review the
sanitized result before committing; use a fully synthetic economic analogue when
the owner does not want those facts published. Never commit the private mapping,
original statements or authentication material.

## Fixture package and independent expectations

Use a manifest with fixed as-of date, scope, currencies, conventions, provenance,
and checksums. Separate activities, external flows, account-balance anchors,
historical prices/FX and corporate actions. Provide hand-verified expected opening
and ending cash/holdings per account, external contribution schedule, paired
transfer cancellation, and portfolio totals.

Later add a custom-inception range that starts after the first investment. Its
opening value must be independently verified rather than treated as zero. Include
account-only views of an internal transfer and a whole-portfolio view. Retain a
cross-date transfer to test future in-transit valuation. Expected results must
come from reconciled statements or an independent worksheet, not the code under
test. Add subsequent performance/tax expectations only in their respective phase.
