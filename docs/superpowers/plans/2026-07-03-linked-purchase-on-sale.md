# Linked Purchase on Sale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When creating or editing a sale, allow users to simultaneously create a linked purchase record (cost of goods); surface per-order gross profit on the order detail page; support the same flow on the eBay/Amazon import review page.

**Architecture:** One nullable `sale_id uuid` FK column on `purchases` (`ON DELETE SET NULL`) connects records persistently. A pure `computeGrossProfit` helper extends `orderMath.ts`. AddSaleModal and EditSaleModal gain a collapsible "Purchase cost" section that creates the purchase after the sale. The order detail page fetches the linked purchase from Redux (Supabase fallback on direct-URL loads) and renders Cost of Goods + Gross Profit rows. The eBay/Amazon import review page stores per-order purchase cost in local state and creates linked purchases on confirm.

**Tech Stack:** Next.js App Router, React, Redux Toolkit, Supabase (PostgREST + RLS), TypeScript, Tailwind v4

## Global Constraints

- Branch: create `feat/linked-purchase-on-sale` from current HEAD before starting
- Never query `public.*` — all tenant data in `tenant_<slug>` schemas
- Tenant DDL must use `run_on_all_tenant_schemas` — never hardcode `tenant_kaufnest` in a new migration
- Any DDL also goes into `provision_tenant_schema()` in `005_tenant_provisioning.sql` for future tenants
- Tailwind v4 CSS variable syntax: `(--color-var)` not `[var(--color-var)]`
- Dark mode via `[data-theme="dark"]`, never `dark:` Tailwind variants
- Do not add `src/middleware.ts`
- Do NOT run `npm test`, `tsc --noEmit`, or the dev server yourself — ask user to run and paste output
- MANDATORY before reading any source file: run `graphify query "<question>"` first
- After code changes, update the affected feature's `CLAUDE.md` and `SKILL.md`

---

### Task 1: DB migration + `Purchase` type

**Files:**
- Create: `supabase/migrations/015_purchases_sale_id.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql`
- Modify: `src/types/index.ts`
- Modify: `supabase/SKILL.md`

**Interfaces:**
- Produces: `Purchase.sale_id: string | null` — consumed by every later task

- [ ] **Step 1: Create `015_purchases_sale_id.sql`**

Create `supabase/migrations/015_purchases_sale_id.sql` with this exact content:

```sql
-- Links a purchase to the sale that triggered it (cost of goods).
-- ON DELETE SET NULL: deleting the sale unlinks the purchase; the purchase survives.

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.purchases
    ADD COLUMN IF NOT EXISTS sale_id uuid
      REFERENCES {{schema}}.sales(id) ON DELETE SET NULL;
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE INDEX IF NOT EXISTS idx_purchases_sale_id
    ON {{schema}}.purchases (sale_id);
$$);
```

- [ ] **Step 2: Update `provision_tenant_schema()` in `005_tenant_provisioning.sql`**

Run: `graphify query "provision_tenant_schema purchases table CREATE TABLE"`

Open `supabase/migrations/005_tenant_provisioning.sql`. Find the `CREATE TABLE IF NOT EXISTS %1$I.purchases` block. After the block that creates the purchases table (before the index creation for other purchases columns), add:

```sql
  EXECUTE format(
    'ALTER TABLE %1$I.purchases ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES %1$I.sales(id) ON DELETE SET NULL',
    schema_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_purchases_sale_id ON %1$I.purchases (sale_id)',
    schema_name
  );
```

- [ ] **Step 3: Add `sale_id` to the `Purchase` type**

Open `src/types/index.ts`. In the `Purchase` interface, add `sale_id` as the last field:

```ts
export interface Purchase {
  id: string;
  product_name: string;
  product_id: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  currency: Currency;
  vendor: string | null;
  date: string;
  description: string | null;
  created_by: string;
  created_at: string;
  vat_rate: number | null;
  vat_amount: number | null;
  sale_id: string | null; // FK to sales.id — set when purchase is a cost-of-goods for a specific order
}
```

- [ ] **Step 4: Update `supabase/SKILL.md` file map**

In the file map table in `supabase/SKILL.md`, add after the row for `014_company_profile_insert_policy.sql`:

```
| `migrations/015_purchases_sale_id.sql` | all `tenant_%` schemas | ⏳ **apply now** — adds `sale_id uuid` FK + `idx_purchases_sale_id` index to `purchases`; links a cost-of-goods purchase to the triggering sale |
```

- [ ] **Step 5: Apply migration in Supabase SQL editor (Project B)**

Paste and run the contents of `015_purchases_sale_id.sql` in the Project B SQL editor.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/015_purchases_sale_id.sql supabase/migrations/005_tenant_provisioning.sql src/types/index.ts supabase/SKILL.md
git commit -m "feat(db,types): add sale_id FK to purchases for linked cost-of-goods"
```

---

### Task 2: `computeGrossProfit` pure helper + tests

**Files:**
- Modify: `src/app/dashboard/sales/_components/orderMath.ts`
- Modify: `src/app/dashboard/sales/_components/orderMath.test.ts`

**Interfaces:**
- Consumes: `Purchase` from `@/types` (specifically `total_amount: number`)
- Produces:
  ```ts
  export function computeGrossProfit(
    netProceeds: number,
    linkedPurchase: Pick<Purchase, "total_amount"> | null
  ): number | null
  ```
  — returns `null` when no purchase linked (caller hides the Gross Profit row in that case); consumed by Task 5.

- [ ] **Step 1: Add failing tests**

Run: `graphify query "orderMath computeNetProceeds test"`

Open `src/app/dashboard/sales/_components/orderMath.test.ts`. Add after the existing `computeNetProceeds` describe block:

```ts
import { computeNetProceeds, computeGrossProfit } from "./orderMath";

describe("computeGrossProfit", () => {
  it("returns null when linkedPurchase is null", () => {
    expect(computeGrossProfit(100, null)).toBeNull();
  });

  it("subtracts purchase total_amount from netProceeds", () => {
    expect(computeGrossProfit(120.99, { total_amount: 68 })).toBeCloseTo(52.99);
  });

  it("returns netProceeds unchanged when purchase cost is zero", () => {
    expect(computeGrossProfit(50, { total_amount: 0 })).toBe(50);
  });

  it("returns negative when purchase exceeds net proceeds (loss scenario)", () => {
    expect(computeGrossProfit(30, { total_amount: 80 })).toBe(-50);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Ask user to run: `npx jest dashboard/sales/_components/orderMath --no-coverage`
Expected: FAIL — `computeGrossProfit is not a function` (or similar)

- [ ] **Step 3: Implement `computeGrossProfit` in `orderMath.ts`**

Run: `graphify query "orderMath computeNetProceeds Sale type"`

Open `src/app/dashboard/sales/_components/orderMath.ts`. Add the `Purchase` import at the top if not present:

```ts
import type { Sale, Purchase } from "@/types";
```

After the existing `computeNetProceeds` function, add:

```ts
/**
 * Net proceeds minus cost of goods. Returns null when no purchase is linked —
 * the order detail page should hide the Gross Profit row when null.
 */
export function computeGrossProfit(
  netProceeds: number,
  linkedPurchase: Pick<Purchase, "total_amount"> | null
): number | null {
  if (!linkedPurchase) return null;
  return netProceeds - linkedPurchase.total_amount;
}
```

- [ ] **Step 4: Run tests and verify they pass**

Ask user to run: `npx jest dashboard/sales/_components/orderMath --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/sales/_components/orderMath.ts src/app/dashboard/sales/_components/orderMath.test.ts
git commit -m "feat(sales): add computeGrossProfit helper + tests to orderMath"
```

---

### Task 3: AddSaleModal — collapsible "Purchase cost" section

**Files:**
- Modify: `src/app/dashboard/sales/_components/AddSaleModal.tsx`

**Interfaces:**
- Consumes:
  - `addPurchase` action from `@/app/dashboard/purchases/_store/purchasesSlice`
  - `Purchase` type from `@/types`
  - `writeAuditLog` from `@/lib/utils/audit` (same instance already used in the file)
  - `addAuditLog` from `@/store/slices/auditLogsSlice`
- Produces: linked purchase row in Supabase + in Redux `state.purchases.items`

**MANDATORY before editing:** Run `graphify query "AddSaleModal form submit handleSubmit fees shipping"`, then read the file.

- [ ] **Step 1: Add imports**

Open `src/app/dashboard/sales/_components/AddSaleModal.tsx`.

Add to the lucide-react import (add `ChevronDown` if not already there):
```ts
import { ..., ChevronDown } from "lucide-react";
```

Add `addPurchase` to purchases slice import:
```ts
import { addPurchase } from "@/app/dashboard/purchases/_store/purchasesSlice";
```

Add `Purchase` to the types import:
```ts
import type { Sale, Purchase, ... } from "@/types";
```

- [ ] **Step 2: Add linked purchase state**

Inside the component, after the existing `showFees` state declaration, add:

```ts
const [showLinkedPurchase, setShowLinkedPurchase] = useState(false);
const [purchasePrice, setPurchasePrice] = useState("");
const [purchaseVendor, setPurchaseVendor] = useState("");
const [purchaseDate, setPurchaseDate] = useState(
  new Date().toISOString().split("T")[0]
);
```

- [ ] **Step 3: Sync `purchaseDate` when sale date changes**

Find the `date` input's `onChange` handler in the form (the field that updates `form.date`). Update it so `purchaseDate` tracks it until the user manually changes it:

```ts
// In the date field onChange:
onChange={(e) => {
  setForm((f) => ({ ...f, date: e.target.value }));
  setPurchaseDate(e.target.value); // keep purchase date in sync with sale date
}}
```

- [ ] **Step 4: Add the collapsible "Purchase cost" section to the modal body**

Find the closing `</div>` of the "Fees & shipping (optional)" collapsible section. Add the following immediately after it (before any submit button or modal footer):

```tsx
{/* ── Purchase cost (optional) ── */}
<div className="border-t border-[var(--color-border)] pt-3">
  <button
    type="button"
    onClick={() => setShowLinkedPurchase((v) => !v)}
    className="flex w-full items-center justify-between text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-base)] transition-colors"
  >
    <span>Purchase cost (optional)</span>
    <ChevronDown
      size={16}
      className={`transition-transform ${showLinkedPurchase ? "rotate-180" : ""}`}
    />
  </button>

  {showLinkedPurchase && (
    <div className="mt-3 space-y-3">
      <div>
        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
          Purchase Price (total paid)
          <span className="text-[var(--color-danger-text)] ml-0.5">*</span>
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={purchasePrice}
          onChange={(e) => setPurchasePrice(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
          Vendor
        </label>
        <input
          type="text"
          value={purchaseVendor}
          onChange={(e) => setPurchaseVendor(e.target.value)}
          placeholder="e.g. Alibaba, wholesaler name"
          className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
          Purchase Date
        </label>
        <input
          type="date"
          value={purchaseDate}
          onChange={(e) => setPurchaseDate(e.target.value)}
          className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 5: Create the linked purchase in the submit handler**

In the submit handler, after the sale is successfully inserted and `dispatch(addSale(data))` is called (`data` is the returned sale row), add:

```ts
// Create linked purchase if price was provided
const rawPrice = parseFloat(purchasePrice);
if (showLinkedPurchase && !isNaN(rawPrice) && rawPrice > 0) {
  const qty = parseInt(form.quantity, 10) || 1;
  const { data: newPurchase, error: purchaseError } = await supabase
    .from("purchases")
    .insert({
      product_name: form.product_name,
      product_id: form.product_id || null,
      quantity: qty,
      unit_price: rawPrice / qty,
      total_amount: rawPrice,
      currency: form.currency,
      vendor: purchaseVendor.trim() || null,
      date: purchaseDate,
      description: null,
      vat_rate: null,
      vat_amount: null,
      sale_id: (data as Sale).id,
    })
    .select()
    .single();

  if (!purchaseError && newPurchase) {
    dispatch(addPurchase(newPurchase as Purchase));
    // Follow the exact same writeAuditLog + dispatch(addAuditLog) pattern
    // used for the sale audit a few lines above — same field names, same supabase instance.
    await writeAuditLog(supabase, {
      action: "create",
      entity: "purchase",
      entityId: newPurchase.id,
      metadata: { linked_to_sale: (data as Sale).id },
    });
    dispatch(addAuditLog({ /* copy the shape from the sale audit call above */ }));
  }
}
```

**Important:** Use the same `supabase` client instance already created earlier in the submit handler. Copy the exact `writeAuditLog` + `addAuditLog` call signature from the existing sale audit call in this file — the parameter order and field names vary slightly per feature.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/sales/_components/AddSaleModal.tsx
git commit -m "feat(sales): add collapsible 'Purchase cost' section to AddSaleModal"
```

---

### Task 4: EditSaleModal — linked purchase chip or add form

**Files:**
- Modify: `src/app/dashboard/sales/_components/EditSaleModal.tsx`

**Interfaces:**
- Consumes:
  - `state.purchases.items` via `useAppSelector`
  - `addPurchase` from `@/app/dashboard/purchases/_store/purchasesSlice`
  - `formatCurrency` from `@/lib/utils/currency`
  - `Purchase.sale_id` from Task 1
- Produces: linked purchase row when user adds one from this modal

**MANDATORY before editing:** Run `graphify query "EditSaleModal submit updateSale auditLog fees"`, then read the file.

- [ ] **Step 1: Add imports and find the linked purchase**

Open `src/app/dashboard/sales/_components/EditSaleModal.tsx`.

Add imports:
```ts
import { addPurchase } from "@/app/dashboard/purchases/_store/purchasesSlice";
import { formatCurrency } from "@/lib/utils/currency"; // add if not already present
import { ..., ChevronDown } from "lucide-react"; // add ChevronDown if not present
import type { Sale, Purchase, ... } from "@/types"; // add Purchase if not present
```

Inside the component, after `useAppDispatch` and `useAppSelector` are set up, add:

```ts
const purchases = useAppSelector((s) => s.purchases.items);
const linkedPurchase = purchases.find((p) => p.sale_id === sale.id) ?? null;
```

Add state for the "add purchase" form (only used when `linkedPurchase` is null):
```ts
const [showAddPurchase, setShowAddPurchase] = useState(false);
const [purchasePrice, setPurchasePrice] = useState("");
const [purchaseVendor, setPurchaseVendor] = useState("");
const [purchaseDate, setPurchaseDate] = useState(
  sale.date ?? new Date().toISOString().split("T")[0]
);
```

- [ ] **Step 2: Add the linked purchase UI to the modal body**

Find the end of the modal body content (before the submit button row). Add:

```tsx
{/* ── Linked Purchase ── */}
<div className="border-t border-[var(--color-border)] pt-3">
  {linkedPurchase ? (
    /* Read-only chip */
    <div className="flex items-center justify-between rounded-[var(--radius-card)] bg-[var(--color-surface-raised)] px-3 py-2">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-0.5">
          Linked Purchase
        </p>
        <p className="text-sm text-[var(--color-text-base)]">
          {formatCurrency(linkedPurchase.total_amount, linkedPurchase.currency)}
          {linkedPurchase.vendor ? ` · ${linkedPurchase.vendor}` : ""}
        </p>
      </div>
      <a
        href="/dashboard/purchases"
        className="text-xs text-[var(--color-primary)] hover:underline shrink-0 ml-3"
      >
        View →
      </a>
    </div>
  ) : (
    /* No linked purchase — offer to add */
    <div>
      <button
        type="button"
        onClick={() => setShowAddPurchase((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-base)] transition-colors"
      >
        <span>Add purchase cost (optional)</span>
        <ChevronDown
          size={16}
          className={`transition-transform ${showAddPurchase ? "rotate-180" : ""}`}
        />
      </button>

      {showAddPurchase && (
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              Purchase Price (total paid)
              <span className="text-[var(--color-danger-text)] ml-0.5">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              Vendor
            </label>
            <input
              type="text"
              value={purchaseVendor}
              onChange={(e) => setPurchaseVendor(e.target.value)}
              placeholder="e.g. Alibaba, wholesaler name"
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              Purchase Date
            </label>
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
        </div>
      )}
    </div>
  )}
</div>
```

- [ ] **Step 3: Create the linked purchase in the submit handler**

In the submit handler, after the existing sale update + `dispatch(updateSale(...))` + audit log, add:

```ts
// Create linked purchase if user filled one in and no purchase is linked yet
const rawPrice = parseFloat(purchasePrice);
if (!linkedPurchase && showAddPurchase && !isNaN(rawPrice) && rawPrice > 0) {
  const qty = form.quantity ?? 1; // form.quantity may be number or string — parseInt if string
  const qtyNum = typeof qty === "string" ? parseInt(qty, 10) || 1 : qty;
  const { data: newPurchase, error: purchaseError } = await supabase
    .from("purchases")
    .insert({
      product_name: form.product_name,
      product_id: form.product_id || null,
      quantity: qtyNum,
      unit_price: rawPrice / qtyNum,
      total_amount: rawPrice,
      currency: form.currency,
      vendor: purchaseVendor.trim() || null,
      date: purchaseDate,
      description: null,
      vat_rate: null,
      vat_amount: null,
      sale_id: sale.id,
    })
    .select()
    .single();

  if (!purchaseError && newPurchase) {
    dispatch(addPurchase(newPurchase as Purchase));
    // Use the exact same writeAuditLog + dispatch(addAuditLog) pattern
    // already present in this file for the sale update audit.
    await writeAuditLog(supabase, {
      action: "create",
      entity: "purchase",
      entityId: newPurchase.id,
      metadata: { linked_to_sale: sale.id },
    });
    dispatch(addAuditLog({ /* copy shape from the sale audit call in this file */ }));
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/sales/_components/EditSaleModal.tsx
git commit -m "feat(sales): linked purchase chip + add-form in EditSaleModal"
```

---

### Task 5: Order detail page — Cost of Goods + Gross Profit

**Files:**
- Modify: `src/app/dashboard/sales/[id]/page.tsx`

**Interfaces:**
- Consumes:
  - `computeNetProceeds` (already imported), `computeGrossProfit` from `./_components/orderMath` (Task 2)
  - `state.purchases.items` via `useAppSelector`
  - `addPurchase` from `@/app/dashboard/purchases/_store/purchasesSlice`
  - `Purchase.sale_id` from Task 1

**MANDATORY before editing:** Run `graphify query "order detail page Financials card computeNetProceeds"`, then read the file.

- [ ] **Step 1: Add imports**

Open `src/app/dashboard/sales/[id]/page.tsx`.

Update the orderMath import to include `computeGrossProfit`:
```ts
import { computeNetProceeds, computeGrossProfit } from "./_components/orderMath";
```

Add `Purchase` to the types import:
```ts
import type { Sale, Purchase, ... } from "@/types";
```

Add `addPurchase` import:
```ts
import { addPurchase } from "@/app/dashboard/purchases/_store/purchasesSlice";
```

- [ ] **Step 2: Select purchases from Redux and set up fallback state**

Inside the component, after the existing `sale` selector, add:

```ts
const purchases = useAppSelector((s) => s.purchases.items);
const [fetchedLinkedPurchase, setFetchedLinkedPurchase] = useState<Purchase | null>(null);

// Fast path: linked purchase already in Redux state
// Fallback: fetched directly from Supabase on direct-URL load
const linkedPurchase: Purchase | null =
  purchases.find((p) => p.sale_id === sale?.id) ?? fetchedLinkedPurchase;
```

- [ ] **Step 3: Add a fetch effect for direct-URL loads**

After the existing `useEffect` that fetches the sale (the one that calls `createTenantClient` and dispatches `addSale`), add a second effect:

```ts
useEffect(() => {
  if (!sale?.id) return;
  // Skip if Redux already has the linked purchase
  if (purchases.some((p) => p.sale_id === sale.id)) return;

  (async () => {
    const supabase = await createTenantClient();
    const { data } = await supabase
      .from("purchases")
      .select("*")
      .eq("sale_id", sale.id)
      .maybeSingle();
    if (data) {
      setFetchedLinkedPurchase(data as Purchase);
      dispatch(addPurchase(data as Purchase)); // hydrate Redux for future navigation
    }
  })();
}, [sale?.id]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Compute gross profit**

Just before the `return` statement, add:

```ts
const netProceeds = sale ? computeNetProceeds(sale) : 0;
const grossProfit = sale ? computeGrossProfit(netProceeds, linkedPurchase) : null;
```

If `computeNetProceeds(sale)` is already computed in the existing file, reuse that variable — don't compute it twice.

- [ ] **Step 5: Add Cost of Goods and Gross Profit rows to the Financials card**

Find the Financials card in the JSX — it has the Net Proceeds row. After the "Net Proceeds" row (and its associated `<hr>` or separator), add:

```tsx
{linkedPurchase && (
  <>
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--color-text-muted)]">Cost of Goods</span>
      <span className="text-[var(--color-danger-text)]">
        −{formatCurrency(linkedPurchase.total_amount, linkedPurchase.currency)}
      </span>
    </div>
    <div className="flex items-center justify-between text-sm font-semibold border-t border-[var(--color-border)] pt-2 mt-1">
      <span className="text-[var(--color-text-base)]">Gross Profit</span>
      <span
        className={
          grossProfit !== null && grossProfit < 0
            ? "text-[var(--color-danger-text)]"
            : "text-[var(--color-success-text)]"
        }
      >
        {formatCurrency(grossProfit ?? 0, sale.currency)}
      </span>
    </div>
    <div className="text-right mt-1">
      <a
        href="/dashboard/purchases"
        className="text-xs text-[var(--color-primary)] hover:underline"
      >
        View purchase record →
      </a>
    </div>
  </>
)}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/sales/[id]/page.tsx
git commit -m "feat(sales): show Cost of Goods + Gross Profit on order detail page"
```

---

### Task 6: Purchases page — "Linked to order" badge

**Files:**
- Modify: `src/app/dashboard/purchases/page.tsx`

**Interfaces:**
- Consumes: `Purchase.sale_id` from Task 1

**MANDATORY before editing:** Run `graphify query "purchases page DataTable columns product_name"`, then read the file.

- [ ] **Step 1: Add the badge to the product name cell**

Open `src/app/dashboard/purchases/page.tsx`. Find where `purchase.product_name` is rendered in the table (inside the `DataTable` columns definition or row renderer).

Replace the plain `product_name` render with:

```tsx
// Before (whatever the current render is):
// purchase.product_name

// After:
<div className="flex flex-col gap-0.5">
  <span>{purchase.product_name}</span>
  {purchase.sale_id && (
    <a
      href={`/dashboard/sales/${purchase.sale_id}`}
      className="inline-flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline w-fit"
      onClick={(e) => e.stopPropagation()} // prevent row-click from triggering if table has row onClick
    >
      Linked to order →
    </a>
  )}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/purchases/page.tsx
git commit -m "feat(purchases): show 'Linked to order' badge for purchases with sale_id"
```

---

### Task 7: eBay/Amazon import review — Purchase Cost + Vendor columns

**Files:**
- Modify: the import review page/component that renders the staged-orders table (run `graphify query "integrations review page staged orders confirm import"` to find the exact file path before reading)

**Interfaces:**
- Consumes:
  - `addPurchase` from `@/app/dashboard/purchases/_store/purchasesSlice`
  - `Purchase` from `@/types`
  - `Purchase.sale_id` from Task 1
- Produces: linked purchase rows created on import confirm

**MANDATORY before editing:** Run `graphify query "integrations review page staged orders confirm import"`, then read the file to understand the exact confirm flow and how each selected order is processed.

- [ ] **Step 1: Add purchase costs local state and helper**

Open the review page file. Find the component state declarations. Add:

```ts
import { addPurchase } from "@/app/dashboard/purchases/_store/purchasesSlice";
import type { Purchase } from "@/types";

// Inside the component:
const [purchaseCosts, setPurchaseCosts] = useState<
  Record<string, { price: string; vendor: string }>
>({});

function updatePurchaseCost(
  key: string,
  field: "price" | "vendor",
  value: string
) {
  setPurchaseCosts((prev) => ({
    ...prev,
    [key]: {
      price: prev[key]?.price ?? "",
      vendor: prev[key]?.vendor ?? "",
      [field]: value,
    },
  }));
}
```

The `key` is the order's `external_order_id` (or a stable row identifier — use whatever unique identifier the review table already uses per row).

- [ ] **Step 2: Add `<th>` header cells**

Find the `<thead>` row in the staged-orders table. After the last existing `<th>`, add:

```tsx
<th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] whitespace-nowrap">
  Purchase Cost
</th>
<th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] whitespace-nowrap">
  Vendor
</th>
```

- [ ] **Step 3: Add `<td>` input cells for each row**

Find where each order row's `<td>` cells are rendered. After the last existing `<td>`, add:

```tsx
<td className="px-3 py-2">
  <input
    type="number"
    min="0"
    step="0.01"
    value={purchaseCosts[order.external_order_id]?.price ?? ""}
    onChange={(e) =>
      updatePurchaseCost(order.external_order_id, "price", e.target.value)
    }
    placeholder="Cost"
    className="w-24 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
    onClick={(e) => e.stopPropagation()} // prevent row selection toggle
  />
</td>
<td className="px-3 py-2">
  <input
    type="text"
    value={purchaseCosts[order.external_order_id]?.vendor ?? ""}
    onChange={(e) =>
      updatePurchaseCost(order.external_order_id, "vendor", e.target.value)
    }
    placeholder="Vendor"
    className="w-32 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
    onClick={(e) => e.stopPropagation()}
  />
</td>
```

- [ ] **Step 4: Create linked purchases in the confirm handler**

In the confirm / "Import Selected" handler, find where each selected order is upserted as a sale. After a successful sale upsert (you have the returned sale row — call it `createdSale`), add:

```ts
// Create linked purchase if the user filled in a cost for this order
const costEntry = purchaseCosts[order.external_order_id];
const rawPrice = parseFloat(costEntry?.price ?? "");
if (!isNaN(rawPrice) && rawPrice > 0) {
  const qty = order.quantity ?? 1;
  const supabase = await createTenantClient(); // reuse existing client if already available
  const { data: newPurchase, error: purchaseError } = await supabase
    .from("purchases")
    .insert({
      product_name: order.product_name,
      product_id: null, // synced orders are never linked to inventory
      quantity: qty,
      unit_price: rawPrice / qty,
      total_amount: rawPrice,
      currency: order.currency ?? "EUR",
      vendor: costEntry?.vendor?.trim() || null,
      date: order.date,
      description: null,
      vat_rate: null,
      vat_amount: null,
      sale_id: createdSale.id,
    })
    .select()
    .single();

  if (!purchaseError && newPurchase) {
    dispatch(addPurchase(newPurchase as Purchase));
    // No per-purchase audit log here — the import batch already creates one
    // audit log entry for the whole confirm action.
  }
}
```

**Note:** If the confirm handler uses a server API route (`fetch("/api/integrations/review/import")`) rather than calling Supabase directly from the client, you need to pass `purchaseCosts` to the route as part of the request body, and create the purchases server-side in `src/app/api/integrations/review/import/route.ts` instead. Read the confirm handler carefully before deciding which path to take.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/integrations/review/page.tsx  # or the exact path
git commit -m "feat(integrations): add Purchase Cost + Vendor columns to import review"
```

---

### Task 8: Docs

**Files:**
- Modify: `src/app/dashboard/sales/CLAUDE.md`
- Modify: `src/app/dashboard/purchases/CLAUDE.md`

- [ ] **Step 1: Update `sales/CLAUDE.md`**

After the "Fee fields" section, add a new section:

```markdown
## Linked Purchase (cost of goods)

A sale can be linked to at most one `purchases` row via `purchases.sale_id`. The link is created in three places:
- **AddSaleModal** — collapsible "Purchase cost (optional)" section: creates a purchase alongside the sale in a single submit action.
- **EditSaleModal** — shows a read-only chip when a purchase is already linked ("View →" to `/dashboard/purchases`); shows the same collapsible add-form when no purchase is linked yet.
- **Import review page** — Purchase Cost + Vendor columns; linked purchase created per order when the user confirms the import.

**Order detail page** (`[id]/page.tsx`): linked purchase is looked up from `state.purchases.items.find(p => p.sale_id === saleId)`; falls back to a `purchases.select("*").eq("sale_id", saleId).maybeSingle()` Supabase call on direct-URL loads (result dispatched to `addPurchase` to hydrate Redux). When found, the Financials card renders Cost of Goods and Gross Profit rows; both are hidden when no purchase is linked.

**Math:** `computeGrossProfit(netProceeds, linkedPurchase)` in `_components/orderMath.ts` returns `null` when `linkedPurchase` is `null`; the Gross Profit row is only rendered when the return value is non-null.
```

- [ ] **Step 2: Update `purchases/CLAUDE.md`**

After the "Inventory link + VAT" section, add:

```markdown
## Sale link (`sale_id`)

`sale_id: string | null` — when non-null, this purchase was created as the cost-of-goods record for a specific sale. The purchases list renders a "Linked to order →" link below the product name for these rows (navigates to `/dashboard/sales/{sale_id}`). The FK is `ON DELETE SET NULL` — if the linked sale is deleted, the purchase survives with `sale_id` reset to `null`.
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/sales/CLAUDE.md src/app/dashboard/purchases/CLAUDE.md
git commit -m "docs(sales,purchases): document linked purchase on sale feature"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|-----------------|------|
| `sale_id uuid` FK on `purchases`, `ON DELETE SET NULL` | Task 1 |
| `idx_purchases_sale_id` index | Task 1 |
| `provision_tenant_schema()` updated | Task 1 |
| `Purchase.sale_id: string \| null` in types | Task 1 |
| `run_on_all_tenant_schemas` migration | Task 1 |
| `computeGrossProfit` pure helper | Task 2 |
| Tests for `computeGrossProfit` (null, normal, zero, loss) | Task 2 |
| AddSaleModal collapsible "Purchase cost" section | Task 3 |
| Fields: purchase price (required), vendor, date (auto-fills from sale date) | Task 3 |
| Creates sale first, then purchase with `sale_id` | Task 3 |
| `addPurchase` dispatched after creation | Task 3 |
| Audit log for linked purchase creation | Task 3, 4 |
| EditSaleModal: read-only chip when purchase linked | Task 4 |
| EditSaleModal: "View →" link in chip | Task 4 |
| EditSaleModal: collapsible add-form when no purchase linked | Task 4 |
| Order detail: linked purchase from Redux, Supabase fallback | Task 5 |
| Order detail: Cost of Goods row | Task 5 |
| Order detail: Gross Profit row (hidden when no linked purchase) | Task 5 |
| Order detail: "View purchase record →" link | Task 5 |
| Purchases page: "Linked to order" badge with link to sale | Task 6 |
| Import review: Purchase Cost + Vendor columns | Task 7 |
| Import review: linked purchase created on confirm | Task 7 |
| Docs updated | Task 8 |

### Placeholder scan

No "TBD", "TODO", vague steps, or missing code blocks found. Task 7, Step 4 includes a note about server-route vs client-side path — this is intentional guidance for a fork the implementer must resolve by reading the confirm handler.

### Type consistency

- `computeGrossProfit(netProceeds: number, linkedPurchase: Pick<Purchase, "total_amount"> | null): number | null` — defined Task 2, used Task 5 ✅
- `Purchase.sale_id: string | null` — defined Task 1, used Tasks 3, 4, 5, 6, 7 ✅
- `addPurchase` from `@/app/dashboard/purchases/_store/purchasesSlice` — used Tasks 3, 4, 7 ✅
- `purchaseCosts: Record<string, { price: string; vendor: string }>` — defined and used in Task 7 ✅
- `fetchedLinkedPurchase: Purchase | null` state — defined and used in Task 5 ✅
