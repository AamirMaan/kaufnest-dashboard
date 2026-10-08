# Payouts feature

Route: `/dashboard/payouts`. History of platform payouts (eBay/Amazon → bank
transfers) recorded in `platform_payouts`, with Record and Delete.

## Files

- `page.tsx` — paginated list (`fetchPayoutsPage`), `FilterBar` (date preset/
  period, currency) + a Platform `<select>` child, `DataTable` (Date, Platform,
  Amount, Notes, Recorded by, Actions), `Pagination`, error banner + Retry.
  "+ Record Transfer" opens the shared `RecordTransferModal`
  (`../_components/`) without a `platform` prop (platform + currency Selects,
  currency defaults to `companyProfile.currency`); on save refetches page 1.
  Delete → `DeleteConfirmModal` → `.delete().eq("id").select("id")` (0 rows =
  RLS refusal, toasted), audit `delete`/`payout`, refetch at
  `pageAfterRemoval` (`@/lib/utils/pagedQuery`). "Recorded by" resolves
  `created_by` against `state.users.items` (`full_name` → `email` → `—`).
- `_store/payoutsSlice.ts` (+ test) — `state.payouts`; `fetchPayoutsPage({
  page, pageSize, filters })`, newest first (`date`, then `created_at`). Throws
  the fixed `PAYOUTS_LOAD_ERROR`, never the Postgres message. Not hydrated by
  `dashboard/layout.tsx` — the page fetches page 1 on mount.
- `_lib/payoutFilters.ts` (+ test) — `PayoutFilters`, `DEFAULT_PAYOUT_FILTERS`,
  `payoutFilterParams` (`resolveDateBounds`; `"all"` → null),
  `isDefaultPayoutFilters`.

## Access (section `payouts`, RLS from migration 055)

View ≥ 1 (route gated by `proxy.ts` via `sections.ts` routes), Record ≥ 2,
Delete ≥ 3. There is no UPDATE policy, so payouts are not editable.

## Shared deps

`components/ui/{DataTable,FilterBar,Pagination,Badge(PlatformBadge),Button,Toast}`,
`components/modals/DeleteConfirmModal`, `dashboard/_components/RecordTransferModal`,
`lib/utils/{pagedQuery,filters,currency,date,audit}`, `store/useAccess`.

## Tests

`npx jest dashboard/payouts`
