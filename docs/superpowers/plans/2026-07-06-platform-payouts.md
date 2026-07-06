# Platform Payouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `platform_payouts` table and a "Record Transfer" modal so users can log eBay/Amazon → bank transfers, which subtract from the platform balance card on the Overview page, revealing Transferred and Pending tiles.

**Architecture:** New `platform_payouts` tenant-schema table (created via `run_on_all_tenant_schemas` + baked into `provision_tenant_schema`). A new `platformPayoutsSlice` is hydrated by `layout.tsx` on page load. The Overview page reads payouts from Redux, filters by date range + platform + currency, and computes `pending = balance − transferred`. A `RecordTransferModal` inserts to DB and dispatches `addPayout` on success.

**Tech Stack:** Next.js App Router, Supabase (tenant-schema RLS), Redux Toolkit, TypeScript, Tailwind CSS, `@/components/ui/Modal`, `@/components/ui/FormFields`.

## Global Constraints

- Never query `public.*` — all tenant data lives in `tenant_<slug>` schemas.
- Never hardcode a schema name in migrations — use `run_on_all_tenant_schemas` for existing tenants AND bake changes into `provision_tenant_schema()` in `005_tenant_provisioning.sql` (the "2 places" rule — see `supabase/SKILL.md`).
- `createTenantClient()` from `@/lib/supabase/client` — browser client for all mutations in modals.
- `createClient()` from `@/lib/supabase/server` — server client for layout.tsx fetches.
- No `src/middleware.ts` — route protection lives in `src/proxy.ts`.
- `accountant` role: read-only; `admin`/`super_admin`: full write access.
- All monetary amounts use `NUMERIC(12,2)`.
- Currency is always one of `"EUR" | "USD" | "GBP"` (the `Currency` type from `src/types/index.ts`).

---

### Task 1: DB migration + TypeScript type + pure helper + tests

**Files:**
- Create: `supabase/migrations/016_platform_payouts.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql`
- Modify: `src/types/index.ts`
- Create: `src/app/dashboard/_lib/platformBalance.ts`
- Create: `src/app/dashboard/_lib/platformBalance.test.ts`

**Interfaces:**
- Produces: `PlatformPayout` interface (used by Tasks 2, 3, 4, 5)
- Produces: `computePending(balance: number, periodPlatformPayouts: PlatformPayout[]): number` (used by Task 4)

---

- [ ] **Step 1: Write the failing test**

Create `src/app/dashboard/_lib/platformBalance.test.ts`:

```ts
import { computePending } from "./platformBalance";
import type { PlatformPayout } from "@/types";

const payout = (amount: number): PlatformPayout => ({
  id: "1",
  platform: "ebay",
  amount,
  currency: "EUR",
  date: "2026-07-01",
  notes: null,
  created_by: "u1",
  created_at: "2026-07-01T00:00:00Z",
});

describe("computePending", () => {
  it("returns balance unchanged when no payouts", () => {
    expect(computePending(500, [])).toBe(500);
  });

  it("subtracts all supplied payouts from balance", () => {
    expect(computePending(500, [payout(200), payout(100)])).toBe(200);
  });

  it("returns negative when over-transferred", () => {
    expect(computePending(100, [payout(150)])).toBe(-50);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx jest dashboard/_lib/platformBalance --no-coverage
```

Expected: FAIL — "Cannot find module './platformBalance'"

- [ ] **Step 3: Add `PlatformPayout` to `src/types/index.ts`**

Open `src/types/index.ts`. After the `Expense` interface (around line 40), insert:

```ts
export interface PlatformPayout {
  id: string;
  platform: "ebay" | "amazon";
  amount: number;
  currency: Currency;
  date: string; // ISO date
  notes: string | null;
  created_by: string;
  created_at: string;
}
```

- [ ] **Step 4: Create `src/app/dashboard/_lib/platformBalance.ts`**

```ts
import type { PlatformPayout } from "@/types";

/**
 * Subtracts recorded payouts from a pre-computed platform balance.
 * Caller passes payouts already filtered by date range and platform.
 */
export function computePending(
  balance: number,
  periodPlatformPayouts: PlatformPayout[]
): number {
  const transferred = periodPlatformPayouts.reduce((acc, p) => acc + p.amount, 0);
  return balance - transferred;
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npx jest dashboard/_lib/platformBalance --no-coverage
```

Expected: PASS — 3 tests passing.

- [ ] **Step 6: Create `supabase/migrations/016_platform_payouts.sql`**

```sql
-- ============================================================
-- Platform payouts — all tenant schemas
--
-- Records eBay/Amazon → bank transfers. Subtracted from the
-- platform balance card on the Overview page to show "Pending"
-- (earned but not yet banked).
--
-- Uses run_on_all_tenant_schemas (applied in 012) so all live
-- tenants get the table. Also baked into provision_tenant_schema()
-- in 005_tenant_provisioning.sql for new tenants.
--
-- Idempotent: CREATE TABLE uses IF NOT EXISTS; policies use
-- DROP IF EXISTS before CREATE.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  CREATE TABLE IF NOT EXISTS {{schema}}.platform_payouts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform     TEXT NOT NULL CHECK (platform IN ('ebay', 'amazon')),
    amount       NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency     TEXT NOT NULL DEFAULT 'EUR',
    date         DATE NOT NULL,
    notes        TEXT,
    created_by   UUID REFERENCES {{schema}}.profiles(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE {{schema}}.platform_payouts ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "platform_payouts_select" ON {{schema}}.platform_payouts;
  CREATE POLICY "platform_payouts_select"
    ON {{schema}}.platform_payouts FOR SELECT
    USING ({{schema}}.is_tenant_member() AND auth.role() = 'authenticated');

  DROP POLICY IF EXISTS "platform_payouts_insert" ON {{schema}}.platform_payouts;
  CREATE POLICY "platform_payouts_insert"
    ON {{schema}}.platform_payouts FOR INSERT
    WITH CHECK ({{schema}}.is_tenant_member() AND {{schema}}.current_user_role() IN ('admin', 'super_admin'));

  DROP POLICY IF EXISTS "platform_payouts_delete" ON {{schema}}.platform_payouts;
  CREATE POLICY "platform_payouts_delete"
    ON {{schema}}.platform_payouts FOR DELETE
    USING ({{schema}}.is_tenant_member() AND {{schema}}.current_user_role() IN ('admin', 'super_admin'));

  CREATE INDEX IF NOT EXISTS idx_platform_payouts_platform_date
    ON {{schema}}.platform_payouts (platform, date);
$$);
```

- [ ] **Step 7: Update `supabase/migrations/005_tenant_provisioning.sql` — bake in for new tenants**

**Change 1 — Table definition.** Find the end of the `platform_connections` CREATE TABLE block (after the closing `$sql$, schema_name);` around line 239). Insert the following block immediately before the `-- ── 2. updated_at triggers` comment:

```sql
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.platform_payouts (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      platform     TEXT NOT NULL CHECK (platform IN ('ebay', 'amazon')),
      amount       NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      currency     TEXT NOT NULL DEFAULT 'EUR',
      date         DATE NOT NULL,
      notes        TEXT,
      created_by   UUID REFERENCES %1$I.profiles(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  $sql$, schema_name);

```

**Change 2 — RLS enable loop.** Find the FOREACH loop (around line 371):
```sql
  FOREACH tbl IN ARRAY ARRAY['profiles', 'expenses', 'purchases', 'sales', 'products', 'audit_logs', 'company_profile', 'platform_connections']
```
Add `'platform_payouts'` to the end of the array:
```sql
  FOREACH tbl IN ARRAY ARRAY['profiles', 'expenses', 'purchases', 'sales', 'products', 'audit_logs', 'company_profile', 'platform_connections', 'platform_payouts']
```

**Change 3 — RLS policies.** After the `platform_connections` policies block (after the line ending `...''super_admin''))', schema_name);`), add:

```sql
  -- platform_payouts — all authenticated tenant members can read; write restricted to admin/super_admin
  EXECUTE format('CREATE POLICY "platform_payouts_select" ON %1$I.platform_payouts FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "platform_payouts_insert" ON %1$I.platform_payouts FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);
  EXECUTE format('CREATE POLICY "platform_payouts_delete" ON %1$I.platform_payouts FOR DELETE USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);

```

**Change 4 — Index.** In section 6 (Indexes), after the last `idx_audit_logs_created` line, add:

```sql
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_platform_payouts_platform_date ON %1$I.platform_payouts (platform, date)', schema_name);
```

- [ ] **Step 8: Apply migration 016 in the Supabase dashboard**

In the Supabase SQL editor for **Project B** (the data-plane project, not the control-plane), run the contents of `supabase/migrations/016_platform_payouts.sql`. Verify with:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'tenant_kaufnest' AND table_name = 'platform_payouts';
```

Expected columns: `id`, `platform`, `amount`, `currency`, `date`, `notes`, `created_by`, `created_at`.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/016_platform_payouts.sql \
        supabase/migrations/005_tenant_provisioning.sql \
        src/types/index.ts \
        src/app/dashboard/_lib/platformBalance.ts \
        src/app/dashboard/_lib/platformBalance.test.ts
git commit -m "feat: add platform_payouts table, PlatformPayout type, and computePending helper"
```

---

### Task 2: Redux slice + store registration

**Files:**
- Create: `src/store/slices/platformPayoutsSlice.ts`
- Modify: `src/store/store.ts`

**Interfaces:**
- Consumes: `PlatformPayout` from `@/types` (Task 1)
- Produces: `hydratePayouts(items: PlatformPayout[])`, `addPayout(item: PlatformPayout)`, `deletePayout(id: string)` actions; `platformPayoutsSlice` (used by Task 3); Redux state key `platformPayouts` with shape `{ items: PlatformPayout[] }` (used by Tasks 3, 4)

---

- [ ] **Step 1: Create `src/store/slices/platformPayoutsSlice.ts`**

```ts
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PlatformPayout } from "@/types";

interface PlatformPayoutsState {
  items: PlatformPayout[];
}

const initialState: PlatformPayoutsState = { items: [] };

const platformPayoutsSlice = createSlice({
  name: "platformPayouts",
  initialState,
  reducers: {
    hydratePayouts(state, action: PayloadAction<PlatformPayout[]>) {
      state.items = action.payload;
    },
    addPayout(state, action: PayloadAction<PlatformPayout>) {
      state.items.unshift(action.payload);
    },
    deletePayout(state, action: PayloadAction<string>) {
      state.items = state.items.filter((p) => p.id !== action.payload);
    },
  },
});

export const { hydratePayouts, addPayout, deletePayout } = platformPayoutsSlice.actions;
export { platformPayoutsSlice };
export default platformPayoutsSlice.reducer;
```

- [ ] **Step 2: Register the reducer in `src/store/store.ts`**

Open `src/store/store.ts`. The current file looks like:

```ts
import { configureStore } from "@reduxjs/toolkit";
import { salesSlice } from "@/app/dashboard/sales/_store/salesSlice";
// ... other imports
import { dropshippingSlice } from "@/app/dashboard/dropshipping/_store/dropshippingSlice";

export const makeStore = () =>
  configureStore({
    reducer: {
      sales: salesSlice.reducer,
      // ...
      dropshipping: dropshippingSlice.reducer,
    },
  });
```

Add one import at the top (after the `dropshippingSlice` import):

```ts
import { platformPayoutsSlice } from "./slices/platformPayoutsSlice";
```

Add one line in the `reducer` object (after `dropshipping`):

```ts
      platformPayouts: platformPayoutsSlice.reducer,
```

- [ ] **Step 3: Verify TypeScript compiles**

Ask the user to run:
```bash
npx tsc --noEmit
```
Expected: no errors related to the new slice.

- [ ] **Step 4: Commit**

```bash
git add src/store/slices/platformPayoutsSlice.ts src/store/store.ts
git commit -m "feat: add platformPayoutsSlice and register reducer"
```

---

### Task 3: Layout hydration + StoreProvider wiring

**Files:**
- Modify: `src/app/dashboard/layout.tsx`
- Modify: `src/store/StoreProvider.tsx`

**Interfaces:**
- Consumes: `PlatformPayout` from `@/types` (Task 1); `hydratePayouts` from `platformPayoutsSlice` (Task 2)
- Produces: `state.platformPayouts.items` populated in the Redux store on page load (consumed by Task 4)

---

- [ ] **Step 1: Update `src/app/dashboard/layout.tsx`**

**Import addition.** In the type import block at the top of the file, add `PlatformPayout` alongside the existing types:

```ts
import type {
  Profile,
  Sale,
  Expense,
  Purchase,
  Product,
  AuditLog,
  CompanyProfile,
  TenantPlan,
  PlatformConnection,
  DropshipListing,
  PlatformPayout,       // ← add this
} from "@/types";
```

**Fetch addition.** In the `Promise.all` array, add a new entry after the `dropship_listings` fetch (the last entry):

```ts
    supabase
      .from("platform_payouts")
      .select("*")
      .order("date", { ascending: false })
      .returns<PlatformPayout[]>(),
```

**Destructure the result.** The `Promise.all` destructuring currently ends with `{ data: dropshipListings }`. Extend it:

```ts
  const [
    { data: salesData, count: salesCount },
    { data: expensesData, count: expensesCount },
    { data: purchasesData, count: purchasesCount },
    { data: productsPage, count: productsCount },
    { data: productSelectors },
    { data: auditLogs, count: auditLogsCount },
    { data: users },
    { data: companyProfile },
    { data: platformConnections },
    { data: dropshipListings },
    { data: platformPayoutsData },      // ← add this
  ] = await Promise.all([
    // ... (unchanged fetch entries, plus new platform_payouts entry at end)
  ]);
```

**StoreProvider prop.** In the `<StoreProvider ...>` JSX, add `platformPayouts` prop after `dropshipListings`:

```tsx
      <StoreProvider
        sales={{ data: salesData ?? [], count: salesCount ?? 0 }}
        expenses={{ data: expensesData ?? [], count: expensesCount ?? 0 }}
        purchases={{ data: purchasesData ?? [], count: purchasesCount ?? 0 }}
        products={{ data: productsPage ?? [], count: productsCount ?? 0 }}
        productSelectors={productSelectors ?? []}
        auditLogs={{ data: auditLogs ?? [], count: auditLogsCount ?? 0 }}
        users={users ?? []}
        currentUser={profile}
        companyProfile={companyProfile ?? undefined}
        tenantPlan={tenantPlan}
        platformConnections={platformConnections ?? []}
        dropshipListings={dropshipListings ?? []}
        platformPayouts={platformPayoutsData ?? []}
      >
```

- [ ] **Step 2: Update `src/store/StoreProvider.tsx`**

**Import addition.** Add `PlatformPayout` to the type imports block and `hydratePayouts` to the action imports:

```ts
import { hydratePayouts } from "./slices/platformPayoutsSlice";
```

```ts
import type {
  Sale,
  Expense,
  Purchase,
  Product,
  AuditLog,
  Profile,
  CompanyProfile,
  TenantPlan,
  PlatformConnection,
  DropshipListing,
  PlatformPayout,       // ← add this
} from "@/types";
```

**Prop addition.** In the `StoreProviderProps` interface, add after `dropshipListings`:

```ts
  platformPayouts?: PlatformPayout[];
```

**Destructure.** Add `platformPayouts` to the function parameter destructuring.

**Dispatch.** In the `useState` initializer, after `store.dispatch(hydrateListings(...))`, add:

```ts
    if (platformPayouts) store.dispatch(hydratePayouts(platformPayouts));
```

- [ ] **Step 3: Verify TypeScript compiles**

Ask the user to run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/layout.tsx src/store/StoreProvider.tsx
git commit -m "feat: hydrate platformPayouts in layout and StoreProvider"
```

---

### Task 4: Overview page — updated balance cards

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `state.platformPayouts.items` (Task 3); `computePending` from `_lib/platformBalance` (Task 1)
- Produces: `transferModal` state + `setTransferModal` handler (consumed by Task 5's modal invocation in JSX)

---

- [ ] **Step 1: Add imports to `src/app/dashboard/page.tsx`**

At the top of the file, add:

```ts
import { computePending } from "./_lib/platformBalance";
import { RecordTransferModal } from "./_components/RecordTransferModal";
import type { PlatformPayout } from "@/types";
```

(The `RecordTransferModal` import will be unused until Step 5 adds the JSX — TypeScript may warn until then. Add the import now so the JSX in Step 5 compiles without changes to the import block.)

- [ ] **Step 2: Add Redux selector and modal state inside `DashboardPage()`**

After the existing `const { theme } = useTheme();` line, add:

```ts
  const payouts = useAppSelector((s) => s.platformPayouts.items);
  const currentUserRole = useAppSelector((s) => s.currentUser.profile?.role);
  const canRecordTransfer = currentUserRole === "admin" || currentUserRole === "super_admin";
  const [transferModal, setTransferModal] = useState<"ebay" | "amazon" | null>(null);
```

- [ ] **Step 3: Add `periodPayouts` memo**

After the `periodPurchases` useMemo (around line 119), add:

```ts
  const periodPayouts = useMemo(
    () =>
      payouts.filter(
        (p) =>
          p.currency === profileCurrency &&
          (range ? p.date >= range.from && p.date <= range.to : true)
      ),
    [payouts, range, profileCurrency]
  );
```

- [ ] **Step 4: Update `ebayBalance` useMemo**

Replace the existing `ebayBalance` useMemo (it currently returns `{ balance, sales, adFees, shippingFees, expenses, count }`). The new version adds `transferred` and `pending`. Add `periodPayouts` to the dependency array:

```ts
  const ebayBalance = useMemo(() => {
    const ebaySales = effectiveSales.filter((s) => s.platform === "ebay");
    if (ebaySales.length === 0) return null;
    const sales = ebaySales.reduce((acc, s) => acc + s.total_amount, 0);
    const adFees = ebaySales.reduce((acc, s) => acc + (s.advertising_fee ?? 0), 0);
    const shippingFees = ebaySales.reduce((acc, s) => acc + (s.shipping_cost ?? 0), 0);
    const expenses = periodExpenses
      .filter((e) => e.vendor?.toLowerCase().includes("ebay") || e.title.toLowerCase().includes("ebay"))
      .reduce((acc, e) => acc + e.amount, 0);
    const balance = sales - adFees - shippingFees - expenses;
    const ebayPayouts = periodPayouts.filter((p) => p.platform === "ebay");
    const transferred = ebayPayouts.reduce((acc, p) => acc + p.amount, 0);
    return {
      balance,
      sales,
      adFees,
      shippingFees,
      expenses,
      transferred,
      pending: computePending(balance, ebayPayouts),
      count: ebaySales.length,
    };
  }, [effectiveSales, periodExpenses, periodPayouts]);
```

- [ ] **Step 5: Update `amazonBalance` useMemo**

Replace the existing `amazonBalance` useMemo with an identical update:

```ts
  const amazonBalance = useMemo(() => {
    const amazonSales = effectiveSales.filter((s) => s.platform === "amazon");
    if (amazonSales.length === 0) return null;
    const sales = amazonSales.reduce((acc, s) => acc + s.total_amount, 0);
    const adFees = amazonSales.reduce((acc, s) => acc + (s.advertising_fee ?? 0), 0);
    const shippingFees = amazonSales.reduce((acc, s) => acc + (s.shipping_cost ?? 0), 0);
    const expenses = periodExpenses
      .filter((e) => e.vendor?.toLowerCase().includes("amazon") || e.title.toLowerCase().includes("amazon"))
      .reduce((acc, e) => acc + e.amount, 0);
    const balance = sales - adFees - shippingFees - expenses;
    const amazonPayouts = periodPayouts.filter((p) => p.platform === "amazon");
    const transferred = amazonPayouts.reduce((acc, p) => acc + p.amount, 0);
    return {
      balance,
      sales,
      adFees,
      shippingFees,
      expenses,
      transferred,
      pending: computePending(balance, amazonPayouts),
      count: amazonSales.length,
    };
  }, [effectiveSales, periodExpenses, periodPayouts]);
```

- [ ] **Step 6: Update the eBay balance card JSX**

Find the eBay card JSX block (inside `{(ebayBalance !== null || amazonBalance !== null) && ...}`). The current card has a `<div className="grid grid-cols-2 gap-3">` with 4 `StatCard` components. Replace the entire eBay card's inner content with the updated version:

```tsx
          {ebayBalance !== null && (
            <div className={cardCls} style={{ boxShadow: "var(--shadow-card)" }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-(--color-text-base)">
                  eBay Balance
                  <span className="ml-2 text-xs font-normal text-(--color-text-faint)">
                    {ebayBalance.count} order{ebayBalance.count !== 1 ? "s" : ""}
                  </span>
                </h2>
                {canRecordTransfer && (
                  <button
                    onClick={() => setTransferModal("ebay")}
                    className="text-xs font-medium px-2.5 py-1 rounded-[var(--radius-btn)] bg-[var(--color-primary-muted)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary)] hover:text-white transition-colors cursor-pointer"
                  >
                    Record Transfer
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Sales"
                  value={formatCurrency(ebayBalance.sales, profileCurrency)}
                  trend="neutral"
                  subtext="Gross revenue"
                />
                <StatCard
                  label="Ad Fees + Shipping"
                  value={formatCurrency(ebayBalance.adFees + ebayBalance.shippingFees, profileCurrency)}
                  trend="down"
                  subtext={`${formatCurrency(ebayBalance.adFees, profileCurrency)} ads · ${formatCurrency(ebayBalance.shippingFees, profileCurrency)} ship`}
                />
                <StatCard
                  label="Expenses"
                  value={formatCurrency(ebayBalance.expenses, profileCurrency)}
                  trend="down"
                  subtext="Vendor/title contains &quot;eBay&quot;"
                />
                <StatCard
                  label="Balance Earned"
                  value={formatCurrency(ebayBalance.balance, profileCurrency)}
                  trend={ebayBalance.balance >= 0 ? "up" : "down"}
                  subtext="Sales − fees − expenses"
                />
                <StatCard
                  label="Transferred"
                  value={formatCurrency(ebayBalance.transferred, profileCurrency)}
                  trend="neutral"
                  subtext="Paid out to bank"
                />
                <StatCard
                  label="Pending"
                  value={formatCurrency(ebayBalance.pending, profileCurrency)}
                  trend={ebayBalance.pending >= 0 ? "up" : "down"}
                  subtext="Still in eBay account"
                />
              </div>
            </div>
          )}
```

- [ ] **Step 7: Update the Amazon balance card JSX**

Apply the exact same change to the Amazon card. Replace its inner content:

```tsx
          {amazonBalance !== null && (
            <div className={cardCls} style={{ boxShadow: "var(--shadow-card)" }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-(--color-text-base)">
                  Amazon Balance
                  <span className="ml-2 text-xs font-normal text-(--color-text-faint)">
                    {amazonBalance.count} order{amazonBalance.count !== 1 ? "s" : ""}
                  </span>
                </h2>
                {canRecordTransfer && (
                  <button
                    onClick={() => setTransferModal("amazon")}
                    className="text-xs font-medium px-2.5 py-1 rounded-[var(--radius-btn)] bg-[var(--color-primary-muted)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary)] hover:text-white transition-colors cursor-pointer"
                  >
                    Record Transfer
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Sales"
                  value={formatCurrency(amazonBalance.sales, profileCurrency)}
                  trend="neutral"
                  subtext="Gross revenue"
                />
                <StatCard
                  label="Ad Fees + Shipping"
                  value={formatCurrency(amazonBalance.adFees + amazonBalance.shippingFees, profileCurrency)}
                  trend="down"
                  subtext={`${formatCurrency(amazonBalance.adFees, profileCurrency)} ads · ${formatCurrency(amazonBalance.shippingFees, profileCurrency)} ship`}
                />
                <StatCard
                  label="Expenses"
                  value={formatCurrency(amazonBalance.expenses, profileCurrency)}
                  trend="down"
                  subtext="Vendor/title contains &quot;Amazon&quot;"
                />
                <StatCard
                  label="Balance Earned"
                  value={formatCurrency(amazonBalance.balance, profileCurrency)}
                  trend={amazonBalance.balance >= 0 ? "up" : "down"}
                  subtext="Sales − fees − expenses"
                />
                <StatCard
                  label="Transferred"
                  value={formatCurrency(amazonBalance.transferred, profileCurrency)}
                  trend="neutral"
                  subtext="Paid out to bank"
                />
                <StatCard
                  label="Pending"
                  value={formatCurrency(amazonBalance.pending, profileCurrency)}
                  trend={amazonBalance.pending >= 0 ? "up" : "down"}
                  subtext="Still in Amazon account"
                />
              </div>
            </div>
          )}
```

- [ ] **Step 8: Add the modal to the JSX**

At the very end of the `return (...)` block, just before the closing `</div>`, add:

```tsx
      {transferModal !== null && (
        <RecordTransferModal
          platform={transferModal}
          currency={profileCurrency}
          pendingBalance={
            transferModal === "ebay"
              ? (ebayBalance?.pending ?? 0)
              : (amazonBalance?.pending ?? 0)
          }
          onClose={() => setTransferModal(null)}
          onSaved={() => setTransferModal(null)}
        />
      )}
```

- [ ] **Step 9: Verify TypeScript compiles**

Ask the user to run:
```bash
npx tsc --noEmit
```
Expected: no errors. (The `RecordTransferModal` import will be temporarily unresolved until Task 5 creates the file — if TypeScript errors on the import, create a stub file first or complete Task 5 before this step.)

- [ ] **Step 10: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: update overview balance cards with Transferred/Pending tiles and Record Transfer button"
```

---

### Task 5: RecordTransferModal

**Files:**
- Create: `src/app/dashboard/_components/RecordTransferModal.tsx`

**Interfaces:**
- Consumes: `addPayout` action from `platformPayoutsSlice` (Task 2); `createTenantClient()` from `@/lib/supabase/client`; `Modal`, `Button`, `Field`, `Input`, `Textarea` from `@/components/ui/*`
- Produces: `RecordTransferModal` component (consumed by page.tsx — Task 4)
- Props consumed by Task 4:
  ```ts
  interface Props {
    platform: "ebay" | "amazon";
    currency: Currency;
    pendingBalance: number;
    onClose: () => void;
    onSaved: () => void;
  }
  ```

---

- [ ] **Step 1: Create `src/app/dashboard/_components/RecordTransferModal.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea, Row } from "@/components/ui/FormFields";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addPayout } from "@/store/slices/platformPayoutsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/currency";
import type { Currency, PlatformPayout } from "@/types";

interface Props {
  platform: "ebay" | "amazon";
  currency: Currency;
  pendingBalance: number;
  onClose: () => void;
  onSaved: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export function RecordTransferModal({
  platform,
  currency,
  pendingBalance,
  onClose,
  onSaved,
}: Props) {
  const dispatch = useAppDispatch();
  const [amount, setAmount] = useState(
    pendingBalance > 0 ? pendingBalance.toFixed(2) : ""
  );
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = parseFloat(amount) || 0;
  const overTransfer = parsedAmount > pendingBalance && pendingBalance > 0;
  const platformLabel = platform === "ebay" ? "eBay" : "Amazon";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!(parsedAmount > 0)) return setError("Amount must be greater than 0.");
    if (!date) return setError("Date is required.");
    setError(null);
    setSaving(true);

    const supabase = await createTenantClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error: dbError } = await supabase
      .from("platform_payouts")
      .insert({
        platform,
        amount: parsedAmount,
        currency,
        date,
        notes: notes.trim() || null,
        created_by: user!.id,
      })
      .select()
      .single<PlatformPayout>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(addPayout(data));
    setSaving(false);
    onSaved();
  }

  return (
    <Modal
      title={`Record ${platformLabel} Transfer`}
      open
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="record-transfer-form" disabled={saving}>
            {saving ? "Saving…" : "Record Transfer"}
          </Button>
        </>
      }
    >
      <form id="record-transfer-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        {/* Read-only platform + currency context */}
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-sm text-[var(--color-text-base)]">
          <span className="font-medium">{platformLabel}</span>
          <span className="mx-2 text-[var(--color-text-faint)]">·</span>
          <span>{currency}</span>
          <span className="mx-2 text-[var(--color-text-faint)]">·</span>
          <span className="text-[var(--color-text-faint)]">
            Pending: {formatCurrency(pendingBalance, currency)}
          </span>
        </div>

        <Row>
          <Field label="Amount" required>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </Field>

          <Field label="Date" required>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </Field>
        </Row>

        {overTransfer && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            This amount exceeds the current pending balance (
            {formatCurrency(pendingBalance, currency)}). The Pending tile will go
            negative — this is allowed if earlier payouts are outside the selected
            date range.
          </p>
        )}

        <Field label="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional reference number or notes…"
            maxLength={500}
          />
        </Field>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Ask the user to run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Run all tests**

Ask the user to run:
```bash
npx jest --no-coverage
```
Expected: all tests pass, including the 3 new `computePending` tests.

- [ ] **Step 4: Manual smoke test**

Ask the user to:
1. Start the dev server (`npm run dev`) and open `http://localhost:3000/dashboard`.
2. Verify the eBay/Amazon balance cards now show 6 tiles in 2×3 layout: Sales, Ad Fees + Shipping, Expenses, Balance Earned, Transferred (€0.00), Pending.
3. Click "Record Transfer" on the eBay card.
4. Verify the modal opens with Amount pre-filled to the current pending balance.
5. Change the amount to a smaller value, pick today's date, click "Record Transfer".
6. Verify the modal closes and the Transferred tile updates immediately (no page reload needed).
7. Verify Pending = Balance Earned − Transferred.
8. Reload the page and confirm the transfer persists.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/_components/RecordTransferModal.tsx
git commit -m "feat: add RecordTransferModal for platform payout recording"
```

- [ ] **Step 6: Update docs**

Update `src/app/dashboard/CLAUDE.md` — in the `page.tsx` description, add to the platform-balance bullet:

> Platform balance cards now also compute `transferred` (sum of `periodPayouts` for the platform) and `pending = balance − transferred`. A "Record Transfer" button (admin/super\_admin only) opens `RecordTransferModal`. `periodPayouts` is filtered from `state.platformPayouts.items` by currency + date range.

```bash
git add src/app/dashboard/CLAUDE.md
git commit -m "docs: update dashboard CLAUDE.md for platform payouts feature"
```
