# eBay fees & account charges via the Finances API — design

Date: 2026-10-21
Status: approved in brainstorming, awaiting spec review
Scope: sub-project 1 of 3 from the "missing eBay info" request. The other two
— order variants (2) and linking an order to an inventory product with
dispatcher notification (3) — get their own specs.

## Problem

The eBay adapter (`src/lib/integrations/ebay.ts`) only calls the Fulfillment
API, which has no fee breakdown. So:

- Per-order fees (final value fee, per-order fixed fee, promoted-listing ad
  fee, international fee) are typed in by hand on Review Orders
  (`mapToSale.ts`'s `ReviewOrderFees`), or not at all.
- Account-level charges that are not tied to an order — insertion (listing)
  fees, store subscription, Promoted Listings Advanced (CPC), shipping
  labels bought on eBay — never reach the dashboard. Nobody imports eBay's
  fee invoice as a CSV today, so there is nothing to reconcile against.

eBay's **Finances API** (`GET https://apiz.ebay.com/sell/finances/v1/transaction`)
returns both: `SALE` transactions carry `orderLineItems[].marketplaceFees[]`,
and `NON_SALE_CHARGE` / `SHIPPING_LABEL` / `CREDIT` transactions carry the
account charges.

## Decisions (from brainstorming)

1. Non-order charges are imported as **Expenses**, auto-categorised.
2. A new expense category **`platform_fees`**. Promoted-listing charges stay
   `advertising`, shipping labels stay `shipping`.
3. Sync is **manual**, matching order sync (no cron):
   - Review Orders **prefills** each order's platform/ad fee from the
     Finances API; the user can still edit before import.
   - A per-account **"Sync eBay charges"** button on Integrations imports the
     last 90 days of account charges straight into Expenses (no review step)
     and **fills empty fees** on already-imported eBay orders. Fees a user
     entered are never overwritten.

## OAuth scope

Add `https://api.ebay.com/oauth/api_scope/sell.finances` to `EBAY_SCOPE`.
Scopes are not granted retroactively (see the existing comment above
`EBAY_SCOPE`), so every existing eBay connection must disconnect and
reconnect once. Until then, Finances calls return 403; both entry points
treat that as a per-account "Reconnect this eBay account to import fees"
message, never a hard failure. Refresh keeps omitting `scope` (existing
behaviour), so pre-existing connections keep working for orders.

## Data model — migration `058_expenses_external_ref.sql`

Via `run_on_all_tenant_schemas`, and mirrored into `provision_tenant_schema()`
(005) in the same commit:

```sql
ALTER TABLE {{schema}}.expenses
  ADD COLUMN IF NOT EXISTS external_ref  text,
  ADD COLUMN IF NOT EXISTS connection_id uuid
    REFERENCES {{schema}}.platform_connections(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_external_ref
  ON {{schema}}.expenses (external_ref);
```

- `external_ref` = `ebay:<transactionId>`. A **full** (non-partial) unique
  index on purpose: Supabase `.upsert({ onConflict })` cannot target a
  partial index (the 033 lesson). Multiple `NULL`s never conflict, so manual
  expenses are unaffected.
- `connection_id` records which eBay account a charge came from (same idea
  as `sales.connection_id`, 056).
- **No category change in SQL.** Checked live 2026-10-21: `expenses.category`
  is plain `text` with no CHECK on all five tenant schemas. `platform_fees`
  is a TypeScript/UI addition only.

`src/types/index.ts`: add `"platform_fees"` to `ExpenseCategory`, and
`external_ref: string | null`, `connection_id: string | null` to `Expense`.
The category also needs a label wherever the list is spelled out today:
`expenses/page.tsx`, `AddExpenseModal.tsx`, `EditExpenseModal.tsx`,
`expenseImportFormats.ts`.

## Units

### `src/lib/integrations/ebay/finances.ts` (server-only)

`fetchFinanceTransactions(accessToken, { from, to, types })` — pages
through `/sell/finances/v1/transaction` (`limit=1000`, follow `offset`
until `total`), filter
`transactionDate:[from..to],transactionType:{SALE|NON_SALE_CHARGE|SHIPPING_LABEL|CREDIT}`.
Returns the raw typed transactions. Throws a `FinancesScopeError` on 403 so
callers can show the reconnect message. Also
`fetchSaleFeesForOrders(accessToken, orderIds)` for the Review Orders
prefill, which filters by `orderId` in batches.

### `src/lib/integrations/ebay/financesMap.ts` (pure, tested)

- `feesByLineItem(saleTxns)` → `Map<"<orderId>:<lineItemId>", { platformFee, advertisingFee }>`.
  `AD_FEE` and any `PROMOTED_LISTING*` fee go to `advertisingFee`; every
  other `marketplaceFees[].feeType` is summed into `platformFee`. Keyed the
  same way as `sales.external_order_id`, so no translation is needed.
- `categoryForCharge(txn)` → `"advertising"` for ad/promoted-listing fee
  types, `"shipping"` for `SHIPPING_LABEL`, otherwise `"platform_fees"`.
- `chargeToExpenseRow(txn, { createdBy, connectionId, accountLabel })` →
  an `expenses` insert row: `title` = humanised fee type ("eBay insertion
  fee"), `vendor` = `"eBay"` (keeps `get_platform_running_balance`'s
  `strpos(lower(...),'ebay')` match working, so these charges reduce the
  eBay running balance), `description` = account label + transaction
  memo/item id, `date` = transaction date, `amount` positive for a charge
  and **negative for a `CREDIT`** (allowed since 032),
  `external_ref` = `ebay:<transactionId>`. Returns `null` for a currency
  outside `EUR/USD/GBP`, and the caller counts those as skipped.

### `POST /api/integrations/ebay/charges/sync` — `{ connectionId }`

1. `requireIntegrationAdmin()` + plan check (`hasPlatformIntegrations`), the
   same gate as the review route. Rows are written with the tenant client,
   so RLS also needs Expenses ≥ 2 and Orders ≥ 2; a 42501 there becomes
   "You don't have permission to add expenses" — never a raw Postgres error.
2. `requireActiveConnection` → `ensureValidAccessToken`.
3. Fetch the last 90 days of `NON_SALE_CHARGE | SHIPPING_LABEL | CREDIT | SALE`.
4. Charges: `upsert(rows, { onConflict: "external_ref", ignoreDuplicates: true })`,
   chunked like `IN_CHUNK`.
5. Order fees: for `SALE` line items, read matching `sales` rows
   (`platform='ebay'`, `external_order_id IN (...)`, chunked) and update
   `platform_fee` where it is `NULL`, and `advertising_fee` where it is
   `NULL`, each independently. A user-entered value is never touched.
6. Returns `{ chargesImported, chargesSkipped, ordersFeesFilled, skippedCurrency }`.
   The client shows it in a toast and hydrates Expenses/Sales on next visit.

### Review Orders prefill — `GET /api/integrations/review`

After fetching an eBay connection's orders, call `fetchSaleFeesForOrders`
for its not-yet-imported order ids and attach
`fees?: { platformFee, advertisingFee }` to each `ReviewOrder`. The page
seeds its `orderFees` state from it (the input stays editable; the bulk
fee-percent toolbar still overwrites). If it throws `FinancesScopeError`,
the orders still load, fees stay blank, and `errors[connectionId]` gets
the reconnect message. Any other Finances failure is logged and ignored, so
fee prefill never blocks order review.

### Integrations UI

`ConnectionCard.tsx` (eBay only): a secondary "Sync eBay charges" button,
busy label "Syncing…" with `RefreshCw` spinning, a toast on success and
failure. Disabled while the account is paused (plan cap). When the last
sync returned a scope error, the card shows the reconnect hint.

## Error handling

| Case | Behaviour |
| --- | --- |
| Pre-scope connection (403) | Reconnect message per account; review still works |
| eBay 5xx / network | Sync route 502 with a generic message; review prefill skipped silently |
| Re-running sync | Idempotent: `external_ref` dedup + fill-only-if-NULL |
| Unsupported currency | Row skipped, counted in `skippedCurrency` |
| Deleted connection | `connection_id` set NULL, expenses kept |

## Testing

- `financesMap.test.ts`: fee bucketing (ad vs platform), multi-fee sum,
  category mapping per type, credit → negative amount, unsupported currency
  → null, `external_ref` format, key format matching `external_order_id`.
- `finances.test.ts`: pagination across offsets, 403 → `FinancesScopeError`
  (mocked `fetch`, same style as `ebay.test.ts`).
- A pure `fillEmptyFees(existing, fees)` helper with a test that a
  non-null fee is never overwritten.
- Manual: reconnect one eBay account, press Sync, check Expenses rows and
  categories, press again (no duplicates), and open Review Orders to see
  prefilled fees.

## Out of scope

- A scheduled/cron sync.
- Amazon fees (the Amazon Finances API is a separate project).
- eBay payouts via Finances (the Payouts feature stays manual).
- Order variants and inventory linking (sub-projects 2 and 3).

## Docs to update with the implementation

`src/lib/integrations/SKILL.md` (Finances module, scope reconnect gotcha),
`dashboard/integrations/CLAUDE.md` (sync button, route),
`dashboard/expenses/SKILL.md` (`platform_fees`, `external_ref`),
`supabase/CLAUDE.md` + `supabase/SKILL.md` file map (058).
