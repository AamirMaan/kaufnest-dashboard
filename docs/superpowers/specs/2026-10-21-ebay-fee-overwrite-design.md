# eBay fee overwrite (super_admin, preview + approve) — design

Date: 2026-10-21 · Branch: `feat/ebay-fee-overwrite` (stacked on PR #130,
`fix/ebay-ad-fee-prefill`, because it reuses #130's order-linked ad-fee logic)

## Problem

"Sync eBay charges" (`/api/integrations/ebay/charges/sync`) only fills order
fee fields that are `NULL` — it never overwrites a value already on the order.
When a stored fee is wrong (hand-typed estimate, bulk-percent from Review
Orders, a fee eBay later adjusted), there is no way to bring it in line with
eBay short of editing each order by hand.

## Goal

A tenant `super_admin` can pull the real Platform Fee and Ad Fee for one eBay
account from the Finances API, see exactly which orders would change (current
→ eBay value), untick any they want to keep, and apply the rest.

## Non-goals

- `shipping_cost`, `shipping_charged`, and non-order charges / Expenses rows —
  untouched (user ruling: Platform + Ad fee only).
- Clearing a fee. If eBay reports no value for a field, that field is never
  proposed.
- Amazon. eBay only.
- Any other role. `admin` keeps "Sync eBay charges" (fill-empty only).

## User flow

1. Integrations page → an active eBay `ConnectionCard` shows a
   `variant="secondary"` button "Overwrite fees from eBay" — rendered only
   when `currentUser.role === "super_admin"` (and `canManage`, as for the
   other card actions).
2. Click → `FeeOverwriteModal` opens in a loading state ("Checking eBay…" with
   `Loader2` spinner) and POSTs the preview route.
3. Modal shows a table, one row per order whose fees differ:
   checkbox · Order ID · date · Platform Fee `current → eBay` · Ad Fee
   `current → eBay` (unchanged cell shows the value plainly; changed cell
   highlights the eBay value; empty current shows "—"). All rows start ticked;
   header checkbox selects/clears all. Below the table: skip counts
   ("3 orders not imported yet, 1 currency mismatch") when non-zero.
4. Footer: Cancel (ghost) and primary "Apply N changes" (N = ticked orders),
   disabled when N = 0 or while applying ("Applying…").
5. Apply → toast "Updated fees on X orders" (+ "Y skipped because they changed
   since the preview" when > 0), modal closes. Failure → error toast, modal
   stays open with selection intact so the user can retry.
6. Nothing differs → modal body "All fees already match eBay." with only a
   Close button.
7. Preview error (scope/signature/plan/permission) → message in the modal
   via `integrationErrorMessage`, Close button.

## Architecture

### Role guard — `src/lib/integrations/authGuard.ts`

`requireIntegrationSuperAdmin()`: runs `requireIntegrationAdmin()` (section
`integrations` ≥ 2) first, then reads `profiles.role` for `userId` via the
returned tenant client (same lookup as `api/users/invite`). Not `super_admin`
→ 403 `{ error: "Forbidden" }`; lookup error → 500 "Could not verify access"
(never the raw Postgres error). The pure role predicate
`canOverwriteEbayFees(role)` lives in client-safe
`src/lib/integrations/feeOverwriteAccess.ts` so the card and the guard share
one rule.

### Pure diff — `src/lib/integrations/ebay/feeOverwrite.ts`

Server-only module, no I/O in its core function:

```ts
type FeeField = "platform_fee" | "advertising_fee";
interface FeeChange { saleId: string; orderId: string; externalOrderId: string;
  currency: string; saleDate: string; field: FeeField; from: number | null; to: number }
computeFeeOverwrites(sales: SaleFeeRow[], ebay: EbayFeesForSales): {
  changes: FeeChange[]; currencyMismatch: number }
```

eBay values come from the **same derivations charge sync uses**, so the two
paths can never disagree on what "eBay's fee" is:

- Platform fee (and SALE-level ad fee): `feesByLineItem(txns)` keyed by
  `external_order_id` (`orderId:lineItemId`) — per line item, exactly as
  charge-sync step 2. `mixedCurrency` or currency ≠ `sale.currency` → counted
  in `currencyMismatch`, no change.
- Order-linked ad fee: `orderLinkedChargeFees(txns)` — applied to the order's
  **first line item** only (charge-sync step 3 / `findOrderSale` ordering),
  only the group in the sale's currency.
- Precedence (same as #130's `withOrderLinkedAdFees`): a SALE ad fee in the
  sale's currency on **any** line of the order wins, and the order-linked
  charge is ignored for that order; otherwise the order-linked ad fee goes on
  the first line item. They are never summed. (`withOrderLinkedAdFees`'s
  "skip partly-imported orders" rule is Review-prefill-only and does not apply
  here — overwrite only ever targets imported rows.)
- A change is emitted only when eBay's value is non-null and differs from the
  stored value after rounding both to 2 dp. No status exclusion — charge sync
  fills fees regardless of order status, and this follows the same rule.

To share these rules, extract charge sync's per-sale "what does eBay say this
row's fees are" step into an exported helper in `chargeSync.ts` (or a new
`ebay/orderFees.ts`) used by both `applyFinanceTransactions` and the preview.
Charge sync's behaviour must not change — its existing tests guard that.

### Preview route — `POST /api/integrations/ebay/fees/preview`

Body `{ connectionId }`. Guard `requireIntegrationSuperAdmin()`, plan check
(`hasPlatformIntegrations`), `requireActiveConnection`, eBay-only — same
prologue and error mapping as the charge-sync route (scope / signature /
account errors → 409 codes). Fetches `SALE` + `NON_SALE_CHARGE` Finances
transactions over the same 90-day `LOOKBACK_MS`. Reads the affected sales in
`IN_CHUNK` batches with `.in("external_order_id", …)` (plus first-line-item
lookup for order-linked charges), runs `computeFeeOverwrites`, and returns:

```ts
{ changes: FeeChange[]; currencyMismatch: number; notImported: number }
```

No writes. `maxDuration = 60`.

### Apply route — `POST /api/integrations/ebay/fees/apply`

Body `{ connectionId, changes: { saleId, field, from, to }[] }`. Same guard
and connection check (no eBay call). Validation in pure
`parseFeeOverwriteApply(body)` (`src/lib/integrations/ebay/feeOverwriteApply.ts`):
`field` ∈ the two fee fields, `to` finite and ≥ 0, `from` number or null,
`saleId` a uuid, at most `MAX_APPLY_CHANGES = 2000` items, no duplicate
`(saleId, field)`; otherwise 400. Writes are compare-and-set, bounded
concurrency (`mapLimit`, `WRITE_CONCURRENCY`):

```ts
update({ [field]: to }).eq("id", saleId).eq("platform", "ebay")
  .eq("connection_id", connectionId)
  [from === null ? "is" : "eq"](field, from).select("id")
```

0 rows → `staleSkipped++` (changed since preview, or RLS denied). `42501` →
403. Each applied change writes `writeAuditLog` (`action: "update"`,
`entityType: "sale"`, metadata `{ source: "ebay_fee_overwrite", field, from,
to, connectionId }`). Returns `{ applied, staleSkipped }`.

Trusting client `to` values is not an escalation: a super_admin can already
set any fee on any order through Edit Order. The `connection_id` filter keeps
the write scoped to the account that was previewed.

### UI

- `src/app/dashboard/integrations/_components/FeeOverwriteModal.tsx` — the
  organism above, built on `Modal`, `Button`, `DataTable`
  (`emptyMessage` = "All fees already match eBay.") and native checkbox
  inputs styled like `review/page.tsx`'s (there is no `Checkbox` atom).
- `src/app/dashboard/integrations/_lib/feeOverwriteSelection.ts` (+ test) —
  pure: group `FeeChange[]` into per-order rows, selected-set toggling,
  build the apply payload from ticked orders, toast text.
- `ConnectionCard.tsx` — the button + modal mount.
- Types the client needs (`FeeChange`, response shapes) are declared
  client-safe in `_lib` (as `chargeSyncSummary.ts` does), never imported
  from the server-only module.

## Error handling

| Case | Result |
| --- | --- |
| not super_admin | 403, button not rendered |
| missing `sell.finances` / signing | 409 `INTEGRATION_FINANCES_SCOPE` / `_SIGNATURE`, mapped copy in modal |
| paused/disconnected account | 409 `INTEGRATION_ACCOUNT_*` |
| row changed between preview and apply | skipped, counted in `staleSkipped`, shown in toast |
| bad apply payload | 400 |
| unexpected | 502 generic copy, raw error logged server-side only |

## Testing

- `feeOverwrite.test.ts` — unchanged values emit nothing; eBay null emits
  nothing; differing value emits `from → to`; NULL current emits
  `from: null`; currency mismatch / mixed currency counted; order-linked ad
  fee lands on first line item only; multi-line order platform fees per line.
- `chargeSync.test.ts` — existing suite still green after the extraction.
- `feeOverwriteApply.test.ts` — validator accept/reject cases incl. cap and
  duplicates.
- `feeOverwriteAccess.test.ts` — only `super_admin` passes.
- `feeOverwriteSelection.test.ts` — grouping, toggle-all, payload, toast text.

## Docs

`src/app/dashboard/integrations/{CLAUDE,SKILL}.md` (file map, new routes,
gotcha: overwrite is the only path that replaces a non-null fee) and
`src/lib/integrations/SKILL.md` (Finances section: shared fee derivation,
compare-and-set apply).

## Revisions (planning, 2026-10-21)

1. **No extraction from `chargeSync.ts`.** `feesByLineItem` and
   `orderLinkedChargeFees` are already exported from `financesMap.ts` and are
   exactly what charge sync uses; `computeFeeOverwrites` composes them
   directly. Only `IN_CHUNK`/`chunks` were exported from `chargeSync.ts`.
2. **Apply does not filter writes by `connection_id`.** Legacy rows may have
   `connection_id = NULL` and would always count as stale. The write is scoped
   by `id` + `platform = 'ebay'` + compare-and-set on the previewed value; the
   route still requires the account to be active.
3. **The role predicate lives at `src/lib/utils/feeOverwriteAccess.ts`**, not
   `src/lib/integrations/`: the verifier blocks client imports of
   `@/lib/integrations/*`.
4. The modal's primary button reads "Apply N orders" (N = ticked order lines).
