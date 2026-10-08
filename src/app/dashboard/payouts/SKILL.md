# Payouts — agent playbook

## Minimal file set per change

- **Add a column / change row actions:** `page.tsx` only.
- **Add a filter:** `_lib/payoutFilters.ts` (+ test) for the type, default,
  params and `isDefaultPayoutFilters`; `_store/payoutsSlice.ts` to apply the
  predicate; `page.tsx` for the control.
- **Change the record form:** `../_components/RecordTransferModal.tsx` +
  `../_lib/recordTransfer.ts` (+ test). It is shared with Home — keep the
  fixed-`platform` + `pendingBalance` path working.

## Gotchas

- "Recorded by" shows "—" for rows created by other users when the viewer is a
  non-admin with `payouts` >= 1: tenant `profiles` SELECT policies are only
  `profiles_select_self` and `profiles_select_admin` (migrations 005/010; 055
  adds none), so `state.users.items` lacks those profiles. Real fix later: a
  `created_by_name` column or a SECURITY DEFINER lookup RPC.
- Filters are persisted in `state.payouts.filters` (set from
  `fetchPayoutsPage.fulfilled`'s `meta.arg`) and the page seeds its `useState`
  from it; otherwise a remount resets the FilterBar while the slice still
  holds filtered rows.

- `platform_payouts` used to be fully loaded by `dashboard/layout.tsx` into a
  `platformPayoutsSlice` nobody read (unbounded; truncated at PostgREST Max
  Rows). Removed 2026-10-08 — don't reintroduce layout hydration; Home and
  Analytics get payout totals from `get_payouts_overview` /
  `get_platform_running_balance`.
- A forbidden delete is not an error under RLS — it deletes 0 rows. The
  `.select("id")` after `.delete()` is what detects it.
- Home's pending-balance figures come from RPCs, so deleting/recording here
  is reflected on Home on its next load, not live.
