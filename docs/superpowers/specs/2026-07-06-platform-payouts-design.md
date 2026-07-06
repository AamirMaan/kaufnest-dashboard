# Platform Payouts Design Spec

## Overview

Allow users to record when eBay or Amazon pays out their accumulated balance to a bank account. Each payout is stored in a new `platform_payouts` table and subtracted from the platform balance card on the Overview page, revealing a **Pending** tile (what's still sitting in the platform, not yet banked).

This is an asset transfer (platform account → bank account), not an expense — it must not affect net profit.

---

## Architecture

**Storage:** New `platform_payouts` tenant-schema table. Not stored in `expenses` because a payout does not reduce profit — it just moves money between accounts.

**Data flow:**
1. `layout.tsx` fetches all payouts on page load (small table — no pagination needed) and passes them to `StoreProvider`.
2. `StoreProvider` dispatches `hydratePayouts` into the new `platformPayoutsSlice`.
3. `page.tsx` reads payouts from Redux, filters by selected date range + platform + currency, and computes `pending = balance − transferred`.
4. Each platform card gains two extra StatCards (Transferred, Pending) and a "Record Transfer" button in its header.
5. The `RecordTransferModal` inserts to DB and dispatches `addPayout`.

**Balance formula (per date range, per platform):**
```
Balance   = Sales − AdFees − Shipping − Expenses   (unchanged)
Pending   = Balance − Transferred (payouts in period)
```

---

## Data Model

### DB migration — `supabase/migrations/016_platform_payouts.sql`

```sql
-- Uses run_on_all_tenant_schemas (applied in 012) so all tenants get the table.
-- Also baked into provision_tenant_schema() for new tenants.
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

  -- RLS: all authenticated tenant users can read; admin/super_admin can write.
  ALTER TABLE {{schema}}.platform_payouts ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "platform_payouts_select" ON {{schema}}.platform_payouts;
  CREATE POLICY "platform_payouts_select"
    ON {{schema}}.platform_payouts FOR SELECT
    USING ({{schema}}.current_user_role() IN ('accountant', 'admin', 'super_admin'));

  DROP POLICY IF EXISTS "platform_payouts_insert" ON {{schema}}.platform_payouts;
  CREATE POLICY "platform_payouts_insert"
    ON {{schema}}.platform_payouts FOR INSERT
    WITH CHECK ({{schema}}.current_user_role() IN ('admin', 'super_admin'));

  DROP POLICY IF EXISTS "platform_payouts_delete" ON {{schema}}.platform_payouts;
  CREATE POLICY "platform_payouts_delete"
    ON {{schema}}.platform_payouts FOR DELETE
    USING ({{schema}}.current_user_role() IN ('admin', 'super_admin'));

  CREATE INDEX IF NOT EXISTS platform_payouts_platform_date_idx
    ON {{schema}}.platform_payouts (platform, date);
$$);
```

**`provision_tenant_schema()` in `005_tenant_provisioning.sql`** must be updated to include the `CREATE TABLE` and policies above (the 2-places rule — see `supabase/SKILL.md`).

### TypeScript type — `src/types/index.ts`

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

---

## Redux Slice — `src/store/slices/platformPayoutsSlice.ts`

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
export default platformPayoutsSlice.reducer;
```

Register in `src/store/store.ts` under key `platformPayouts`.

---

## Layout Hydration — `src/app/dashboard/layout.tsx`

Add to the `Promise.all` fetch array:

```ts
supabase
  .from("platform_payouts")
  .select("*")
  .order("date", { ascending: false })
  .returns<PlatformPayout[]>(),
```

Pass result to `StoreProvider`:

```tsx
<StoreProvider
  ...
  platformPayouts={platformPayoutsData ?? []}
>
```

---

## StoreProvider — `src/store/StoreProvider.tsx`

```ts
// New prop
platformPayouts?: PlatformPayout[];

// In useState initializer
if (platformPayouts) store.dispatch(hydratePayouts(platformPayouts));
```

---

## Overview Page — `src/app/dashboard/page.tsx`

### New state

```ts
const [transferModal, setTransferModal] = useState<"ebay" | "amazon" | null>(null);
```

### Read payouts from Redux

```ts
const payouts = useAppSelector((s) => s.platformPayouts.items);
```

### Filter payouts in memos (add alongside the balance memos)

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

### Update `ebayBalance` and `amazonBalance` memos

Add `transferred` and `pending` to each return value:

```ts
// In ebayBalance useMemo (also depends on periodPayouts):
const ebayPeriodPayouts = periodPayouts.filter((p) => p.platform === "ebay");
const transferred = ebayPeriodPayouts.reduce((acc, p) => acc + p.amount, 0);
const balance = sales - adFees - shippingFees - expenses;
return {
  balance,
  sales, adFees, shippingFees, expenses,
  transferred,
  pending: balance - transferred,   // computePending(balance, ebayPeriodPayouts)
  count: ebaySales.length,
};

// Same pattern for amazonBalance — filter periodPayouts by platform === "amazon"
```

### Updated card layout (per platform card)

Card header gains a "Record Transfer" button (admin/super_admin only — read role from `currentUserSlice`).

Grid changes from 2×2 to 2×3 (6 tiles):

```
| Sales              | Ad Fees + Shipping |
| Expenses           | Balance earned     |
| Transferred        | Pending            |
```

The **Pending** tile uses `trend="up"` when positive (money still owed by platform) and `trend="down"` when negative (over-transferred — data entry error).

### Record Transfer button visibility

```ts
const currentUserRole = useAppSelector((s) => s.currentUser.profile?.role);
const canRecord = currentUserRole === "admin" || currentUserRole === "super_admin";
```

Only render the button when `canRecord` is true.

---

## Modal — `src/app/dashboard/_components/RecordTransferModal.tsx`

### Props

```ts
interface Props {
  platform: "ebay" | "amazon";
  currency: Currency;
  pendingBalance: number;    // pre-fills amount field
  onClose: () => void;
  onSaved: (payout: PlatformPayout) => void;
}
```

### Fields

| Field | Type | Default | Validation |
|---|---|---|---|
| Amount | number input | `pendingBalance` (clamped ≥ 0) | > 0, required |
| Date | date input | today (`new Date().toISOString().slice(0, 10)`) | required |
| Notes | textarea | empty | optional, max 500 chars |

Platform and currency are display-only (pre-filled from props, not editable).

### Behaviour

- On submit: `INSERT INTO platform_payouts` via `createTenantClient()`, then `onSaved(newRow)`.
- Parent dispatches `addPayout(newRow)` and closes modal.
- If amount > pendingBalance: show inline warning "This exceeds the current pending balance" but allow submission (the date-range filter may hide earlier payouts).
- No audit log entry needed — payouts are not sensitive financial mutations like sales deletions.

### Error handling

- DB error → show toast "Failed to record transfer. Please try again."
- Supabase returns the inserted row — use `.select().single()` on the insert.

---

## Utility function (pure, testable)

Extract pending-balance calculation into a helper for unit testing:

**`src/app/dashboard/_lib/platformBalance.ts`**

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

**`src/app/dashboard/_lib/platformBalance.test.ts`**

```ts
import { computePending } from "./platformBalance";
import type { PlatformPayout } from "@/types";

const payout = (amount: number): PlatformPayout => ({
  id: "1", platform: "ebay", amount, currency: "EUR",
  date: "2026-07-01", notes: null, created_by: "u1", created_at: "2026-07-01T00:00:00Z",
});

describe("computePending", () => {
  it("returns balance when no payouts", () => {
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

---

## Files Changed

| Action | Path |
|---|---|
| Create | `supabase/migrations/016_platform_payouts.sql` |
| Modify | `supabase/migrations/005_tenant_provisioning.sql` — bake table + RLS into `provision_tenant_schema()` |
| Modify | `src/types/index.ts` — add `PlatformPayout` interface |
| Create | `src/store/slices/platformPayoutsSlice.ts` |
| Modify | `src/store/store.ts` — register `platformPayouts` reducer |
| Modify | `src/store/StoreProvider.tsx` — add `platformPayouts` prop + hydration dispatch |
| Modify | `src/app/dashboard/layout.tsx` — fetch `platform_payouts`, pass to `StoreProvider` |
| Modify | `src/app/dashboard/page.tsx` — `periodPayouts` memo, updated balance memos, updated card JSX, modal state |
| Create | `src/app/dashboard/_components/RecordTransferModal.tsx` |
| Create | `src/app/dashboard/_lib/platformBalance.ts` |
| Create | `src/app/dashboard/_lib/platformBalance.test.ts` |

---

## Constraints

- Never query `public.*` — all data lives in `tenant_<slug>` schemas via the Supabase client's implicit schema routing.
- Never hardcode a schema name in migrations — use `run_on_all_tenant_schemas`.
- `RecordTransferModal` uses `createTenantClient()` (browser client) — never the control-plane client.
- No separate route or page — the modal lives entirely on the Overview page.
- Payouts respect the same date-range filter as sales/expenses so the Pending figure stays coherent within a period.
- `accountant` role: read-only (can see Transferred/Pending tiles, no "Record Transfer" button).
- `admin` / `super_admin`: full write access.
