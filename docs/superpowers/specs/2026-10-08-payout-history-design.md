# Payout history page — design

Date: 2026-10-08 · Branch: `feat/payout-history`

## Problem

Platform payouts (eBay/Amazon → bank transfers) are recorded from Home's
"Record Transfer" button (`RecordTransferModal`) into `platform_payouts`, but
there is no screen that lists them. They only surface as aggregates
(`get_payouts_overview`). A mistaken payout can't be found or removed from the
UI. Separately, `dashboard/layout.tsx` fetches **every** `platform_payouts`
row on each load (unbounded, silently truncated at PostgREST Max Rows) into a
`platformPayoutsSlice` that nothing reads.

## Goal

A `/dashboard/payouts` page: paginated, filterable history of recorded
payouts, with Record and Delete actions, gated by the existing `payouts`
permission section. No database migration.

## 1. Route, nav, permissions

- New feature folder `src/app/dashboard/payouts/` (`page.tsx`, `_store/`,
  `_lib/`, `CLAUDE.md`, `SKILL.md`).
- `src/lib/permissions/sections.ts`: `payouts` gets
  `routes: ["/dashboard/payouts"]`, so `proxy.ts`'s section guard
  (`sectionForPath`) bounces users below level 1.
- `Sidebar.tsx`: "Payouts" item (`ArrowLeftRight` icon) after Purchases,
  `section: "payouts"`.
- Levels (already enforced by migration 055 RLS — `platform_payouts_select`
  ≥ 1, `_insert` ≥ 2, `_delete` ≥ 3; there is no UPDATE policy):
  - `can("payouts", 1)` — view (page access)
  - `can("payouts", 2)` — "+ Record Transfer" header button
  - `can("payouts", 3)` — row Delete icon

## 2. Data

- `payouts/_store/payoutsSlice.ts` (state key `payouts`), modelled on
  `inventory/_store/transfersSlice.ts`: `items`, `page`, `pageSize`, `total`,
  `loaded`, `isFetching`, `error`.
- Thunk `fetchPayoutsPage({ page, pageSize, filters })`:
  `.from("platform_payouts").select("*", { count: "exact" })
  .order("date", desc).order("created_at", desc).range(from, to)`
  (`rangeFor`, `DEFAULT_PAGE_SIZE` from `lib/utils/pagedQuery`). A raw
  Postgres error is never surfaced — the thunk throws a fixed
  "Could not load payouts." message.
- Filters type `PayoutFilters` (`preset`, `dateFrom`, `dateTo`, `platform:
  "all" | "ebay" | "amazon"`, `currency`) with `DEFAULT_PAYOUT_FILTERS`
  (preset matches the Expenses default), defined in
  `payouts/_lib/payoutFilters.ts` together with the pure
  `payoutFilterParams(f) → { from, to, platform, currency }` mapper
  (`resolveDateBounds`; `"all"` → `null`) and `isDefaultPayoutFilters`.
  The thunk applies `gte/lte("date")`, `eq("platform")`, `eq("currency")` from
  those params. No keyword search (only `notes` is free text; not worth it).
- The page fetches page 1 on mount (no layout hydration).
- **Removed:** the `platform_payouts` query in `dashboard/layout.tsx`, the
  `platformPayouts` prop/`hydratePayouts` dispatch in `StoreProvider.tsx`,
  and `src/store/slices/platformPayoutsSlice.ts` (+ its `store.ts`
  registration). Nothing reads that state; Home/Analytics use RPCs.

## 3. Table

Shared `DataTable` + `FilterBar` (date preset/period + currency built in;
Platform as a child `<select>` like Expenses' Category) + `Pagination`.

Columns: Date (`formatDate`), Platform (`Badge`: eBay / Amazon), Amount
(`formatCurrency(amount, currency)`, tabular-nums), Notes (`—` when null),
Recorded by (display name from `state.users.items` matched on `created_by`,
`—` when not found), Actions (Delete, level 3 only).

`emptyMessage`: "No transfers recorded yet." when filters are default, else
"No transfers match the current filters." Error state: inline message +
secondary "Retry" button (`RefreshCw`), as on the Inventory page.

## 4. Recording

`RecordTransferModal` (stays in `dashboard/_components/`, now used by Home and
Payouts):

- `platform` prop becomes optional. When omitted, the modal renders a
  required platform `Select` (eBay/Amazon) and a required currency `Select`
  (defaults to the company base currency from `companyProfileSlice`); title
  "Record Transfer".
- `pendingBalance` becomes optional; the prefill and over-transfer warning
  only apply when it is given (Home behaviour unchanged).
- Form conventions: `<form id>`, `required` on controls, submit
  `disabled={saving || !isFormValid}`, "Saving…" busy label, toast on success
  and failure.
- The modal stops dispatching `addPayout`; it takes `onSaved(payout)`.
  Payouts page refetches the current page after save; Home just closes.
- It now writes an audit entry (`action: "create"`, `entityType: "payout"`)
  — it wrote none before.

## 5. Delete

Row Delete → shared `DeleteConfirmModal` (typed reason, "Deleting…").
`.delete().eq("id", id)`; on success write an audit log (`action: "delete"`,
`entityType: "payout"`, `metadata: { before, reason }`), dispatch
`addAuditLog`, toast, then refetch at
`pageAfterRemoval(page, pageSize, total)`. On failure, toast a generic
message (never `dbError.message`). `pageAfterRemoval` moves from
`inventory/_lib/transfers.ts` to `lib/utils/pagedQuery.ts` (now 2 users; its
test moves with it; inventory imports it from there).

`AuditEntity` (`src/types/index.ts`) gains `"payout"`; there is no DB check
constraint on `entity_type`. The Audit Logs page's entity filter/labels get
the new value if they enumerate entities.

## 6. Tests & docs

- `payouts/_lib/payoutFilters.test.ts` — param mapping (all/specific
  platform & currency, preset → bounds, custom range).
- `payouts/_store/payoutsSlice.test.ts` — pending/fulfilled/rejected reducer
  states.
- `lib/utils/pagedQuery.test.ts` — moved `pageAfterRemoval` cases.
- Docs: new `payouts/CLAUDE.md` + `SKILL.md`; root `AGENTS.md` feature table;
  `dashboard/CLAUDE.md` (layout no longer fetches payouts, feature table,
  `RecordTransferModal` now shared); `inventory` docs for the moved helper;
  `lib/utils/SKILL.md` for `pageAfterRemoval`.

## Out of scope

Editing payouts (no UPDATE RLS policy), CSV export, summary tiles.
