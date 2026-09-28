# Phase 3: custom portfolio date ranges

Phase 3 adds one-off and saved custom ranges to the existing shared portfolio
filter. It does not add a valuation timeline or a new performance formula.

## Date semantics

Custom bounds are strict `YYYY-MM-DD` accounting dates. Both displayed bounds are
inclusive. The resolver represents the internal start as the final millisecond
before `from` and the end as the final millisecond of `to`, using UTC calendar-date
arithmetic throughout. Invalid calendar dates, inverted bounds, future ends,
incomplete bounds, and mixed named/custom inputs are rejected rather than clamped.

Existing named ranges continue through the pre-existing local-time resolver without
changes. Requests without custom parameters therefore retain their prior meaning.

## Saved ranges and TODAY

Saved ranges remain private user settings in the existing Settings JSON:

```json
{
  "id": "stable UUID",
  "name": "User-visible name",
  "from": "2026-01-01",
  "endMode": "FIXED | TODAY",
  "to": "2026-12-31"
}
```

`to` is present only for `FIXED`. A `TODAY` range retains that mode in storage and
resolves the current UTC accounting date each time the backend handles a request.
Renames preserve the id. Malformed or duplicate-id legacy settings are ignored
safely. Saved ranges follow the authenticated viewer in shared/impersonated views,
so another user's private names and definitions are not exposed.

## UI and request state

Custom and saved choices live in the shared header portfolio filter beside the
existing named ranges. Native date inputs preserve ISO values while displaying
according to the browser locale. One-off selections persist in the existing user
settings state as explicit bounds; saved selections persist by stable id. The
client sends either `range=custom&from=...&to=...` or
`range=custom&savedRangeId=...` to interval-aware portfolio and activity requests.

Saved-range create, update/rename, and delete controls are hidden during
impersonation. One-off filtering remains available through the viewer's own filter
settings.

## Cache behavior

The custom resolver exposes a canonical identity made from its resolved effective
`from` and `to`. Equivalent intervals therefore share identity, different bounds
do not, and a `TODAY` range changes identity on the next accounting day.

The current portfolio snapshot cache stores full range-independent history and
derives the requested interval after reading that snapshot. No custom derived
result is cached in Phase 3, so the existing snapshot key and ROAI cache semantics
remain unchanged. A future analytics-result cache must use the resolver's effective
identity after resolving `TODAY`.

## Compatibility and deferred work

YTD, 1Y, MAX, calendar years, other named ranges, existing URLs, and existing ROAI
fields retain their meanings. Holdings and benchmark panels keep their existing
named-range behavior where custom interval analytics would require new calculation
work.

Valuation timelines, Modified Dietz, TWR, XIRR, custom benchmark analysis,
drawdown, attribution, and the future analytics cache namespace remain deferred.
