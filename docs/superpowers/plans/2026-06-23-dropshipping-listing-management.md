# Dropshipping Listing Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a listing-management page at `/dashboard/dropshipping` that imports a tenant's active eBay listings via their existing OAuth connection, stores them in `public.dropship_listings`, and lets every role link each listing to an Amazon or AliExpress supplier URL.

**Architecture:** API routes own all DB and eBay API access. A Redux slice holds client state. `dashboard/layout.tsx` hydrates listings on mount. All components use shadcn UI (`cn()` from `@/lib/utils`). Follows the exact same pattern as the Integrations feature.

**Tech Stack:** Next.js App Router, Redux Toolkit, Supabase (public schema), shadcn/ui (Table, Dialog, Input), eBay Sell Inventory REST API, TypeScript.

## Global Constraints

- Currency: use `formatCurrency(amount, currency)` — `currency` from the listing row (`EUR`, `GBP`, etc.)
- Schema: `dropship_listings` lives in **`public`** (consistent with all current tables; Phase 3 tenant-schema migration has not been applied to new tables)
- eBay REST: same `EBAY_BASE` env/sandbox flag as `src/lib/integrations/ebay.ts`; new scope `sell.inventory.readonly` required
- `cn()` from `@/lib/utils` for all className merging in shadcn components
- No `dark:` Tailwind variants; use `var(--color-*)` CSS variables (project uses `[data-theme="dark"]`, not `.dark` class)
- Plan gate: `hasPlatformIntegrations(tenantPlan)` — Pro/Business only
- All roles may view listings; only `admin`/`super_admin` may trigger "Refresh from eBay" (the route reads OAuth tokens from `platform_connections`, which RLS restricts to admin roles)
- No delete — eBay is source of truth; refresh upserts, never removes rows
- shadcn Button naming conflict on macOS: **never run `npx shadcn add button`**. Use the existing `Button` component from `@/components/ui/Button` (variant `"primary"/"secondary"/"danger"/"ghost"`).

---

### Task 1: DB Migration + TypeScript Types

**Files:**
- Create: `supabase/009_dropship_listings.sql`
- Modify: `src/types/index.ts` (append at bottom of Platform Integrations section)

**Interfaces:**
- Produces: `SourcePlatform`, `DropshipListing` — consumed by Tasks 3, 5, 6, 8

- [ ] **Step 1: Write migration SQL**

Create `supabase/009_dropship_listings.sql`:

```sql
-- Migration 009: dropship_listings table
-- Stores tenant's active eBay listings with optional supplier source URL.
-- Lives in public schema (consistent with all current tenant tables).

CREATE TABLE IF NOT EXISTS public.dropship_listings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ebay_listing_id   text        UNIQUE NOT NULL,
  title             text        NOT NULL,
  image_url         text,
  ebay_url          text        NOT NULL,
  current_price     numeric(10,2) NOT NULL,
  currency          text        NOT NULL DEFAULT 'EUR',
  sku               text,
  source_url        text,
  source_platform   text        CHECK (source_platform IN ('amazon', 'aliexpress')),
  last_synced_at    timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- RLS: same pattern as platform_connections — tenant users only
ALTER TABLE public.dropship_listings ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (accountants need read access)
CREATE POLICY "tenant_select_dropship_listings"
  ON public.dropship_listings
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admin/super_admin can insert/update (enforced by API route auth guard)
-- Using the same approach as other tables: RLS allows authenticated, route enforces role
CREATE POLICY "tenant_insert_dropship_listings"
  ON public.dropship_listings
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "tenant_update_dropship_listings"
  ON public.dropship_listings
  FOR UPDATE
  USING (auth.role() = 'authenticated');
```

- [ ] **Step 2: Add TypeScript types**

Open `src/types/index.ts`. After the `PlatformConnection` interface (end of file), append:

```ts
// ─── Dropshipping ─────────────────────────────────────────────────────────────

export type SourcePlatform = "amazon" | "aliexpress";

export interface DropshipListing {
  id: string;
  ebay_listing_id: string;
  title: string;
  image_url: string | null;
  ebay_url: string;
  current_price: number;
  currency: string;
  sku: string | null;
  source_url: string | null;
  source_platform: SourcePlatform | null;
  last_synced_at: string;
  created_at: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/009_dropship_listings.sql src/types/index.ts
git commit -m "feat(dropshipping): add dropship_listings DB migration and TS types"
```

> **Apply migration:** Run `supabase/009_dropship_listings.sql` against the Supabase project (Project B) before testing the API routes. The user should run it via the Supabase SQL editor or `supabase db push`.

---

### Task 2: `detectPlatform` Utility + Tests

**Files:**
- Create: `src/lib/utils/detectPlatform.ts`
- Create: `src/lib/utils/detectPlatform.test.ts`

**Interfaces:**
- Produces: `detectPlatform(url: string): SourcePlatform | null` — consumed by Tasks 6 and 8

- [ ] **Step 1: Write failing tests**

Create `src/lib/utils/detectPlatform.test.ts`:

```ts
import { detectPlatform } from "./detectPlatform";

describe("detectPlatform", () => {
  it("detects amazon.com", () => {
    expect(detectPlatform("https://www.amazon.com/dp/B08N5WRWNW")).toBe("amazon");
  });

  it("detects amazon.de", () => {
    expect(detectPlatform("https://www.amazon.de/dp/B08N5WRWNW")).toBe("amazon");
  });

  it("detects amazon.co.uk", () => {
    expect(detectPlatform("https://www.amazon.co.uk/dp/B08N5WRWNW")).toBe("amazon");
  });

  it("detects aliexpress.com", () => {
    expect(detectPlatform("https://www.aliexpress.com/item/1005006123456789.html")).toBe("aliexpress");
  });

  it("returns null for unknown domain", () => {
    expect(detectPlatform("https://www.example.com/product/123")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectPlatform("")).toBeNull();
  });

  it("returns null for malformed URL", () => {
    expect(detectPlatform("not-a-url")).toBeNull();
  });

  it("returns null for partial URL without protocol", () => {
    expect(detectPlatform("amazon.com/product")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest detectPlatform`
Expected: 8 tests fail with `Cannot find module './detectPlatform'`

- [ ] **Step 3: Implement `detectPlatform`**

Create `src/lib/utils/detectPlatform.ts`:

```ts
import type { SourcePlatform } from "@/types";

export function detectPlatform(url: string): SourcePlatform | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  if (hostname.includes("amazon")) return "amazon";
  if (hostname.includes("aliexpress")) return "aliexpress";
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest detectPlatform`
Expected: 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/detectPlatform.ts src/lib/utils/detectPlatform.test.ts
git commit -m "feat(dropshipping): add detectPlatform utility"
```

---

### Task 3: `dropshippingSlice` + Tests

**Files:**
- Create: `src/app/dashboard/dropshipping/_store/dropshippingSlice.ts`
- Create: `src/app/dashboard/dropshipping/_store/dropshippingSlice.test.ts`

**Interfaces:**
- Consumes: `DropshipListing` from `@/types`
- Produces:
  - `dropshippingSlice` — consumed by Task 4 (store wiring)
  - `hydrateListings(listings: DropshipListing[])` — consumed by Task 4 (StoreProvider)
  - `upsertListings(listings: DropshipListing[])` — consumed by Task 8 (page.tsx refresh handler)
  - `updateListingSource({ id: string; sourceUrl: string | null; sourcePlatform: SourcePlatform | null })` — consumed by Task 8 (EditSourceModal)

- [ ] **Step 1: Write failing tests**

Create `src/app/dashboard/dropshipping/_store/dropshippingSlice.test.ts`:

```ts
import { dropshippingSlice, hydrateListings, upsertListings, updateListingSource } from "./dropshippingSlice";
import type { DropshipListing } from "@/types";

const makeListing = (overrides: Partial<DropshipListing> = {}): DropshipListing => ({
  id: "uuid-1",
  ebay_listing_id: "ebay-1",
  title: "Test Listing",
  image_url: null,
  ebay_url: "https://www.ebay.com/itm/12345",
  current_price: 25.99,
  currency: "EUR",
  sku: "SKU-001",
  source_url: null,
  source_platform: null,
  last_synced_at: "2026-06-23T00:00:00Z",
  created_at: "2026-06-23T00:00:00Z",
  ...overrides,
});

const reducer = dropshippingSlice.reducer;

describe("dropshippingSlice", () => {
  it("hydrateListings replaces state with new array", () => {
    const state = { listings: [makeListing({ id: "old" })] };
    const newListings = [makeListing({ id: "new-1" }), makeListing({ id: "new-2", ebay_listing_id: "ebay-2" })];
    const result = reducer(state, hydrateListings(newListings));
    expect(result.listings).toHaveLength(2);
    expect(result.listings[0].id).toBe("new-1");
  });

  it("upsertListings appends new listings", () => {
    const existing = makeListing({ id: "uuid-1", ebay_listing_id: "ebay-1" });
    const state = { listings: [existing] };
    const newListing = makeListing({ id: "uuid-2", ebay_listing_id: "ebay-2" });
    const result = reducer(state, upsertListings([newListing]));
    expect(result.listings).toHaveLength(2);
  });

  it("upsertListings updates existing listing by ebay_listing_id without touching source_url", () => {
    const existing = makeListing({
      id: "uuid-1",
      ebay_listing_id: "ebay-1",
      title: "Old Title",
      source_url: "https://www.amazon.com/dp/OLD",
      source_platform: "amazon",
    });
    const state = { listings: [existing] };
    const updated = makeListing({
      id: "uuid-1",
      ebay_listing_id: "ebay-1",
      title: "New Title",
      source_url: null,     // refresh sends null — should be ignored
      source_platform: null, // same
    });
    const result = reducer(state, upsertListings([updated]));
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0].title).toBe("New Title");
    expect(result.listings[0].source_url).toBe("https://www.amazon.com/dp/OLD");
    expect(result.listings[0].source_platform).toBe("amazon");
  });

  it("updateListingSource updates correct row by id; leaves other rows unchanged", () => {
    const listing1 = makeListing({ id: "uuid-1", ebay_listing_id: "ebay-1" });
    const listing2 = makeListing({ id: "uuid-2", ebay_listing_id: "ebay-2" });
    const state = { listings: [listing1, listing2] };
    const result = reducer(
      state,
      updateListingSource({ id: "uuid-1", sourceUrl: "https://www.amazon.com/dp/NEW", sourcePlatform: "amazon" })
    );
    expect(result.listings[0].source_url).toBe("https://www.amazon.com/dp/NEW");
    expect(result.listings[0].source_platform).toBe("amazon");
    expect(result.listings[1].source_url).toBeNull();
  });

  it("updateListingSource is a no-op if id not found", () => {
    const listing = makeListing({ id: "uuid-1" });
    const state = { listings: [listing] };
    const result = reducer(
      state,
      updateListingSource({ id: "uuid-999", sourceUrl: "https://www.amazon.com/dp/X", sourcePlatform: "amazon" })
    );
    expect(result.listings[0]).toEqual(listing);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest dashboard/dropshipping`
Expected: fail with `Cannot find module './dropshippingSlice'`

- [ ] **Step 3: Implement the slice**

Create `src/app/dashboard/dropshipping/_store/dropshippingSlice.ts`:

```ts
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DropshipListing, SourcePlatform } from "@/types";

interface DropshippingState {
  listings: DropshipListing[];
}

const initialState: DropshippingState = { listings: [] };

export const dropshippingSlice = createSlice({
  name: "dropshipping",
  initialState,
  reducers: {
    hydrateListings(state, action: PayloadAction<DropshipListing[]>) {
      state.listings = action.payload;
    },
    upsertListings(state, action: PayloadAction<DropshipListing[]>) {
      for (const incoming of action.payload) {
        const index = state.listings.findIndex(
          (l) => l.ebay_listing_id === incoming.ebay_listing_id
        );
        if (index >= 0) {
          // Preserve source_url and source_platform — refresh must not overwrite supplier links
          state.listings[index] = {
            ...incoming,
            source_url: state.listings[index].source_url,
            source_platform: state.listings[index].source_platform,
          };
        } else {
          state.listings.push(incoming);
        }
      }
    },
    updateListingSource(
      state,
      action: PayloadAction<{ id: string; sourceUrl: string | null; sourcePlatform: SourcePlatform | null }>
    ) {
      const listing = state.listings.find((l) => l.id === action.payload.id);
      if (listing) {
        listing.source_url = action.payload.sourceUrl;
        listing.source_platform = action.payload.sourcePlatform;
      }
    },
  },
});

export const { hydrateListings, upsertListings, updateListingSource } =
  dropshippingSlice.actions;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest dashboard/dropshipping`
Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/dropshipping/_store/
git commit -m "feat(dropshipping): add dropshippingSlice with hydrate/upsert/updateSource"
```

---

### Task 4: Store Wiring + Sidebar Entry

**Files:**
- Modify: `src/store/store.ts`
- Modify: `src/store/StoreProvider.tsx`
- Modify: `src/app/dashboard/layout.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `dropshippingSlice`, `hydrateListings` from Task 3; `DropshipListing` from `@/types`
- Produces: `state.dropshipping.listings` accessible via `useAppSelector` in Task 8

- [ ] **Step 1: Register slice in `store.ts`**

Open `src/store/store.ts`. Add import and reducer entry:

```ts
// Add this import alongside the other slice imports:
import { dropshippingSlice } from "@/app/dashboard/dropshipping/_store/dropshippingSlice";

// Add to the reducer object inside configureStore:
//   dropshipping: dropshippingSlice.reducer,
```

Full file after edits:

```ts
import { configureStore } from "@reduxjs/toolkit";
import { salesSlice } from "@/app/dashboard/sales/_store/salesSlice";
import { expensesSlice } from "@/app/dashboard/expenses/_store/expensesSlice";
import { purchasesSlice } from "@/app/dashboard/purchases/_store/purchasesSlice";
import { inventorySlice } from "@/app/dashboard/inventory/_store/inventorySlice";
import { auditLogsSlice } from "./slices/auditLogsSlice";
import { usersSlice } from "@/app/dashboard/users/_store/usersSlice";
import { currentUserSlice } from "./slices/currentUserSlice";
import { companyProfileSlice } from "./slices/companyProfileSlice";
import { integrationsSlice } from "@/app/dashboard/integrations/_store/integrationsSlice";
import { dropshippingSlice } from "@/app/dashboard/dropshipping/_store/dropshippingSlice";

export const makeStore = () =>
  configureStore({
    reducer: {
      sales: salesSlice.reducer,
      expenses: expensesSlice.reducer,
      purchases: purchasesSlice.reducer,
      inventory: inventorySlice.reducer,
      auditLogs: auditLogsSlice.reducer,
      users: usersSlice.reducer,
      currentUser: currentUserSlice.reducer,
      companyProfile: companyProfileSlice.reducer,
      integrations: integrationsSlice.reducer,
      dropshipping: dropshippingSlice.reducer,
    },
  });

// Types
export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
```

- [ ] **Step 2: Wire hydration in `StoreProvider.tsx`**

Open `src/store/StoreProvider.tsx`. Add import and prop:

Full file after edits:

```tsx
"use client";

import { useState } from "react";
import { Provider } from "react-redux";
import { makeStore } from "@/store/store";
import { hydrateSales } from "@/app/dashboard/sales/_store/salesSlice";
import { hydrateExpenses } from "@/app/dashboard/expenses/_store/expensesSlice";
import { hydratePurchases } from "@/app/dashboard/purchases/_store/purchasesSlice";
import { hydrateProducts } from "@/app/dashboard/inventory/_store/inventorySlice";
import { hydrateAuditLogs } from "@/store/slices/auditLogsSlice";
import { hydrateUsers } from "@/app/dashboard/users/_store/usersSlice";
import { setCurrentUser, setTenantPlan } from "@/store/slices/currentUserSlice";
import { hydrateCompanyProfile } from "@/store/slices/companyProfileSlice";
import { hydrateConnections } from "@/app/dashboard/integrations/_store/integrationsSlice";
import { hydrateListings } from "@/app/dashboard/dropshipping/_store/dropshippingSlice";
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
} from "@/types";

interface StoreProviderProps {
  children: React.ReactNode;
  sales?: Sale[];
  expenses?: Expense[];
  purchases?: Purchase[];
  products?: Product[];
  auditLogs?: AuditLog[];
  users?: Profile[];
  currentUser?: Profile;
  companyProfile?: CompanyProfile;
  tenantPlan?: TenantPlan | null;
  platformConnections?: PlatformConnection[];
  dropshipListings?: DropshipListing[];
}

export function StoreProvider({
  children,
  sales,
  expenses,
  purchases,
  products,
  auditLogs,
  users,
  currentUser,
  companyProfile,
  tenantPlan,
  platformConnections,
  dropshipListings,
}: StoreProviderProps) {
  const [store] = useState(() => {
    const store = makeStore();
    if (sales)               store.dispatch(hydrateSales(sales));
    if (expenses)            store.dispatch(hydrateExpenses(expenses));
    if (purchases)           store.dispatch(hydratePurchases(purchases));
    if (products)            store.dispatch(hydrateProducts(products));
    if (auditLogs)           store.dispatch(hydrateAuditLogs(auditLogs));
    if (users)               store.dispatch(hydrateUsers(users));
    if (currentUser)         store.dispatch(setCurrentUser(currentUser));
    if (companyProfile)      store.dispatch(hydrateCompanyProfile(companyProfile));
    if (tenantPlan)          store.dispatch(setTenantPlan(tenantPlan));
    if (platformConnections) store.dispatch(hydrateConnections(platformConnections));
    if (dropshipListings)    store.dispatch(hydrateListings(dropshipListings));
    return store;
  });

  return <Provider store={store}>{children}</Provider>;
}
```

- [ ] **Step 3: Add DB fetch to `dashboard/layout.tsx`**

Open `src/app/dashboard/layout.tsx`. Make the following changes:

1. Add `DropshipListing` to the type imports from `@/types`:

```ts
// existing import line, add DropshipListing:
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
} from "@/types";
```

2. Add a `dropship_listings` fetch to the `Promise.all` array (after the `platform_connections` entry):

```ts
    supabase
      .from("dropship_listings")
      .select("*")
      .order("created_at", { ascending: false })
      .returns<DropshipListing[]>(),
```

3. Destructure `{ data: dropshipListings }` from the `Promise.all` result (add as the last entry in the destructuring array).

4. Pass it to `<StoreProvider>`:

```tsx
      dropshipListings={dropshipListings ?? []}
```

The modified `Promise.all` block and JSX should look like:

```ts
  const [
    { data: sales },
    { data: expenses },
    { data: purchases },
    { data: products },
    { data: auditLogs },
    { data: users },
    { data: companyProfile },
    { data: platformConnections },
    { data: dropshipListings },
  ] = await Promise.all([
    supabase
      .from("sales")
      .select("*")
      .order("date", { ascending: false })
      .limit(100)
      .returns<Sale[]>(),
    supabase
      .from("expenses")
      .select("*")
      .order("date", { ascending: false })
      .limit(100)
      .returns<Expense[]>(),
    supabase
      .from("purchases")
      .select("*")
      .order("date", { ascending: false })
      .limit(100)
      .returns<Purchase[]>(),
    supabase
      .from("products")
      .select("*")
      .order("name", { ascending: true })
      .returns<Product[]>(),
    supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
      .returns<AuditLog[]>(),
    supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true })
      .returns<Profile[]>(),
    supabase
      .from("company_profile")
      .select("*")
      .single<CompanyProfile>(),
    supabase
      .from("platform_connections")
      .select(
        "id, platform, status, external_account_id, marketplace_id, last_synced_at, last_sync_status, last_sync_error, updated_at"
      )
      .returns<PlatformConnection[]>(),
    supabase
      .from("dropship_listings")
      .select("*")
      .order("created_at", { ascending: false })
      .returns<DropshipListing[]>(),
  ]);
```

- [ ] **Step 4: Add Sidebar entry**

Open `src/components/layout/Sidebar.tsx`.

Add `Package` to the lucide-react import:

```ts
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  Boxes,
  ClipboardList,
  Users,
  Settings,
  Shield,
  Plug,
  Calculator,
  Package,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
```

Insert the Dropshipping entry in `NAV_ITEMS` between the `Integrations` and `Planner` entries:

```ts
  {
    label: "Dropshipping",
    href: "/dashboard/dropshipping",
    Icon: Package,
    roles: ["super_admin", "admin", "accountant"],
  },
```

- [ ] **Step 5: Commit**

```bash
git add src/store/store.ts src/store/StoreProvider.tsx src/app/dashboard/layout.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(dropshipping): wire dropshippingSlice into Redux store and hydrate from layout"
```

---

### Task 5: eBay Listings Fetcher + Scope Update

**Files:**
- Create: `src/lib/integrations/ebay/listings.ts`
- Modify: `src/lib/integrations/ebay.ts` (update `EBAY_SCOPE`)

**Interfaces:**
- Produces: `fetchActiveListings(accessToken: string): Promise<EbayListing[]>` — consumed by Task 6 (refresh route)

> **Scope note:** Adding `sell.inventory.readonly` to `EBAY_SCOPE` means **existing eBay connections need to be re-authorized** to get inventory access. The refresh API will return a 403 from eBay, which the refresh route bubbles up as a user-readable error: "Your eBay connection needs re-authorization — disconnect and reconnect in Integrations."

- [ ] **Step 1: Update `EBAY_SCOPE` in `src/lib/integrations/ebay.ts`**

Find the line:

```ts
const EBAY_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.fulfillment";
```

Replace with:

```ts
const EBAY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment" +
  " https://api.ebay.com/oauth/api_scope/sell.inventory.readonly";
```

- [ ] **Step 2: Create `src/lib/integrations/ebay/listings.ts`**

```ts
// Fetches the seller's active eBay listings via the Inventory REST API.
// Requires the sell.inventory.readonly OAuth scope — existing connections
// authorised before this scope was added must be re-authorised.

const SANDBOX = process.env.EBAY_SANDBOX === "true";
const EBAY_BASE = SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const INVENTORY_BASE = `${EBAY_BASE}/sell/inventory/v1`;

export interface EbayListing {
  ebayListingId: string;
  title: string;
  imageUrl: string | null;
  ebayUrl: string;
  currentPrice: number;
  currency: string;
  sku: string | null;
}

interface EbayOffer {
  offerId: string;
  sku?: string;
  status: string;
  marketplaceId?: string;
  listing?: { listingId?: string };
  pricingSummary?: { price?: { value?: string; currency?: string } };
}

interface EbayInventoryItem {
  sku: string;
  product?: {
    title?: string;
    imageUrls?: string[];
  };
}

function ebayDomain(marketplaceId?: string): string {
  switch (marketplaceId) {
    case "EBAY_GB": return "co.uk";
    case "EBAY_DE": return "de";
    case "EBAY_FR": return "fr";
    case "EBAY_IT": return "it";
    case "EBAY_ES": return "es";
    case "EBAY_AU": return "com.au";
    default:        return "com";
  }
}

async function inventoryGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${INVENTORY_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 403) {
    throw new Error(
      "eBay returned 403 Forbidden — your eBay connection needs re-authorization. " +
      "Go to Integrations, disconnect eBay, and reconnect to grant the required permissions."
    );
  }

  if (!res.ok) {
    throw new Error(`eBay inventory request failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

export async function fetchActiveListings(accessToken: string): Promise<EbayListing[]> {
  // Fetch published offers and inventory items in parallel — 2 API calls, no N+1.
  const [offersBody, itemsBody] = await Promise.all([
    inventoryGet<{ offers?: EbayOffer[] }>("/offer?limit=200", accessToken),
    inventoryGet<{ inventoryItems?: EbayInventoryItem[] }>("/inventory_item?limit=200", accessToken),
  ]);

  const publishedOffers = (offersBody.offers ?? []).filter(
    (o) => o.status === "PUBLISHED" && o.listing?.listingId
  );

  if (publishedOffers.length === 0) return [];

  const itemsBySku = new Map<string, EbayInventoryItem>(
    (itemsBody.inventoryItems ?? []).map((item) => [item.sku, item])
  );

  return publishedOffers.map((offer) => {
    const listingId = offer.listing!.listingId!;
    const domain = ebayDomain(offer.marketplaceId);
    const item = offer.sku ? itemsBySku.get(offer.sku) : undefined;

    return {
      ebayListingId: listingId,
      title: item?.product?.title ?? offer.sku ?? listingId,
      imageUrl: item?.product?.imageUrls?.[0] ?? null,
      ebayUrl: `https://www.ebay.${domain}/itm/${listingId}`,
      currentPrice: Number(offer.pricingSummary?.price?.value ?? 0),
      currency: offer.pricingSummary?.price?.currency ?? "EUR",
      sku: offer.sku ?? null,
    };
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/ebay.ts src/lib/integrations/ebay/listings.ts
git commit -m "feat(dropshipping): add eBay active listings fetcher; expand OAuth scope"
```

---

### Task 6: API Routes

**Files:**
- Create: `src/app/api/dropshipping/listings/route.ts` (GET)
- Create: `src/app/api/dropshipping/listings/refresh/route.ts` (POST)
- Create: `src/app/api/dropshipping/listings/[id]/route.ts` (PATCH)

**Interfaces:**
- Consumes: `fetchActiveListings` from Task 5; `detectPlatform` from Task 2; `requireIntegrationAdmin` from `@/lib/integrations/authGuard`; `getConnection`, `ensureValidAccessToken` from `@/lib/integrations/tokenStore`; `ebayAdapter` from `@/lib/integrations/ebay`
- Produces: REST API consumed by Task 8 (page.tsx and EditSourceModal)

- [ ] **Step 1: Create GET route**

Create `src/app/api/dropshipping/listings/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { DropshipListing } from "@/types";

export async function GET() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await client
    .from("dropship_listings")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<DropshipListing[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
```

- [ ] **Step 2: Create POST refresh route**

Create `src/app/api/dropshipping/listings/refresh/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { fetchActiveListings } from "@/lib/integrations/ebay/listings";

export async function POST() {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  const conn = await getConnection(client, "ebay");
  if (!conn || conn.status !== "connected") {
    return NextResponse.json(
      { error: "eBay is not connected. Connect it in Integrations first." },
      { status: 400 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await ensureValidAccessToken(client, conn, ebayAdapter);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to refresh eBay token" },
      { status: 500 }
    );
  }

  let listings;
  try {
    listings = await fetchActiveListings(accessToken);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch listings from eBay" },
      { status: 502 }
    );
  }

  if (listings.length === 0) {
    return NextResponse.json({ synced: 0 });
  }

  // Map to DB shape — source_url and source_platform are excluded so the
  // upsert ON CONFLICT clause preserves existing supplier links.
  const rows = listings.map((l) => ({
    ebay_listing_id: l.ebayListingId,
    title: l.title,
    image_url: l.imageUrl,
    ebay_url: l.ebayUrl,
    current_price: l.currentPrice,
    currency: l.currency,
    sku: l.sku,
    last_synced_at: new Date().toISOString(),
  }));

  const { error } = await client.from("dropship_listings").upsert(rows, {
    onConflict: "ebay_listing_id",
    ignoreDuplicates: false,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ synced: rows.length });
}
```

- [ ] **Step 3: Create PATCH route**

Create `src/app/api/dropshipping/listings/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { detectPlatform } from "@/lib/utils/detectPlatform";
import type { DropshipListing } from "@/types";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json()) as { sourceUrl?: string };

  if (typeof body.sourceUrl !== "string" || body.sourceUrl.trim() === "") {
    return NextResponse.json({ error: "sourceUrl is required" }, { status: 400 });
  }

  const sourceUrl = body.sourceUrl.trim();
  const sourcePlatform = detectPlatform(sourceUrl);

  const { data, error } = await client
    .from("dropship_listings")
    .update({ source_url: sourceUrl, source_platform: sourcePlatform })
    .eq("id", id)
    .select("*")
    .single<DropshipListing>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/dropshipping/
git commit -m "feat(dropshipping): add GET/POST refresh/PATCH API routes"
```

---

### Task 7: Install shadcn Components

**Files:**
- shadcn adds component files under `src/components/ui/` (table, dialog, input)

> **Critical:** Do NOT run `npx shadcn add button` — it will overwrite the custom `Button.tsx`. Install only the three components below.

- [ ] **Step 1: Install table, dialog, input**

```bash
npx shadcn@latest add table dialog input
```

Expected: creates `src/components/ui/table.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/input.tsx` (and any internal dependencies they need).

- [ ] **Step 2: Verify `Button.tsx` is intact**

Check that `src/components/ui/Button.tsx` still exports `ButtonVariant`, `ButtonSize`, and the `Button` component with `variant="primary"/"secondary"/"danger"/"ghost"`. If shadcn overwrote it, restore from git: `git checkout HEAD -- src/components/ui/Button.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/table.tsx src/components/ui/dialog.tsx src/components/ui/input.tsx
# Also stage any additional files shadcn may have added (check git status)
git commit -m "chore: install shadcn table, dialog, input components"
```

---

### Task 8: UI Components + Page

**Files:**
- Create: `src/app/dashboard/dropshipping/_components/EditSourceModal.tsx`
- Create: `src/app/dashboard/dropshipping/_components/ListingsTable.tsx`
- Create: `src/app/dashboard/dropshipping/page.tsx`

**Interfaces:**
- Consumes: `state.dropshipping.listings` via `useAppSelector`; `upsertListings`, `updateListingSource` actions; `detectPlatform` from Task 2; `Button` from `@/components/ui/Button`; shadcn Table/Dialog/Input from Task 7; `formatCurrency` from `@/lib/utils/currency`; `useToast` from `@/components/ui/Toast`; `hasPlatformIntegrations` from `@/lib/utils/planGating`

- [ ] **Step 1: Create `EditSourceModal.tsx`**

Create `src/app/dashboard/dropshipping/_components/EditSourceModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useAppDispatch } from "@/store/hooks";
import { updateListingSource } from "../_store/dropshippingSlice";
import { detectPlatform } from "@/lib/utils/detectPlatform";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/Toast";
import type { DropshipListing } from "@/types";

interface EditSourceModalProps {
  listing: DropshipListing | null;
  onClose: () => void;
}

function PlatformBadge({ url }: { url: string }) {
  const platform = detectPlatform(url);
  if (platform === "amazon") {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
        Amazon
      </span>
    );
  }
  if (platform === "aliexpress") {
    return (
      <span className="inline-flex items-center rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
        AliExpress
      </span>
    );
  }
  if (url.trim() === "") return null;
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--color-surface-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
      Unknown
    </span>
  );
}

export function EditSourceModal({ listing, onClose }: EditSourceModalProps) {
  const dispatch = useAppDispatch();
  const { addToast } = useToast();
  const [url, setUrl] = useState(listing?.source_url ?? "");
  const [saving, setSaving] = useState(false);

  // Reset input when a different listing is opened
  const currentId = listing?.id;
  if (listing && listing.source_url !== null && url === "" && listing.source_url !== "") {
    setUrl(listing.source_url);
  }

  async function handleSave() {
    if (!listing || url.trim() === "") return;
    setSaving(true);
    try {
      const res = await fetch(`/api/dropshipping/listings/${listing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: url.trim() }),
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Failed to save source URL");
      }

      const updated = (await res.json()) as { source_url: string; source_platform: "amazon" | "aliexpress" | null };
      dispatch(
        updateListingSource({
          id: listing.id,
          sourceUrl: updated.source_url,
          sourcePlatform: updated.source_platform,
        })
      );
      addToast({ type: "success", message: "Source URL saved." });
      onClose();
    } catch (err) {
      addToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!listing} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link Source Product</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm text-[var(--color-text-muted)] truncate">
            {listing?.title}
          </p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--color-text-base)]">
              Source product URL
            </label>
            <Input
              type="url"
              placeholder="https://www.amazon.com/dp/... or AliExpress URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full"
            />
            <div className="h-5">
              <PlatformBadge url={url} />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={url.trim() === "" || saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create `ListingsTable.tsx`**

Create `src/app/dashboard/dropshipping/_components/ListingsTable.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/utils/currency";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EditSourceModal } from "./EditSourceModal";
import type { DropshipListing } from "@/types";

interface ListingsTableProps {
  listings: DropshipListing[];
}

function SourceBadge({ listing }: { listing: DropshipListing }) {
  if (!listing.source_url) {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--color-surface-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
        Unlinked
      </span>
    );
  }

  const label = listing.source_platform === "amazon"
    ? "Amazon"
    : listing.source_platform === "aliexpress"
    ? "AliExpress"
    : "Linked";

  const className = listing.source_platform === "amazon"
    ? "bg-blue-50 text-blue-700"
    : listing.source_platform === "aliexpress"
    ? "bg-orange-50 text-orange-700"
    : "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]";

  return (
    <div className="flex flex-col gap-1">
      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", className)}>
        {label}
      </span>
      <a
        href={listing.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-[var(--color-primary)] hover:underline truncate max-w-[180px] block"
      >
        {listing.source_url}
      </a>
    </div>
  );
}

export function ListingsTable({ listings }: ListingsTableProps) {
  const [editTarget, setEditTarget] = useState<DropshipListing | null>(null);

  if (listings.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">
          No listings found. Click <strong>Refresh from eBay</strong> to import your active listings.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Image</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-28">Price</TableHead>
              <TableHead className="w-32">SKU</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listings.map((listing) => (
              <TableRow key={listing.id}>
                <TableCell>
                  {listing.image_url ? (
                    <img
                      src={listing.image_url}
                      alt=""
                      width={48}
                      height={48}
                      className="h-12 w-12 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded bg-[var(--color-surface-subtle)]">
                      <ImageIcon size={20} className="text-[var(--color-text-faint)]" />
                    </div>
                  )}
                </TableCell>
                <TableCell className="max-w-[240px]">
                  <a
                    href={listing.ebay_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-[var(--color-text-base)] hover:text-[var(--color-primary)] hover:underline line-clamp-2"
                  >
                    {listing.title}
                  </a>
                </TableCell>
                <TableCell className="text-sm text-[var(--color-text-base)]">
                  {formatCurrency(listing.current_price, listing.currency as "EUR" | "GBP" | "USD")}
                </TableCell>
                <TableCell className="text-sm">
                  {listing.sku ? (
                    <span className="text-[var(--color-text-base)]">{listing.sku}</span>
                  ) : (
                    <span className="text-[var(--color-text-faint)]">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <SourceBadge listing={listing} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditTarget(listing)}
                  >
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EditSourceModal listing={editTarget} onClose={() => setEditTarget(null)} />
    </>
  );
}
```

- [ ] **Step 3: Create `page.tsx`**

Create `src/app/dashboard/dropshipping/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import { hasPermission } from "@/lib/utils/permissions";
import { upsertListings } from "./_store/dropshippingSlice";
import { ListingsTable } from "./_components/ListingsTable";
import type { DropshipListing } from "@/types";

export default function DropshippingPage() {
  const dispatch = useAppDispatch();
  const { addToast } = useToast();
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const connections = useAppSelector((s) => s.integrations.connections);
  const listings = useAppSelector((s) => s.dropshipping.listings);
  const [refreshing, setRefreshing] = useState(false);

  // 1. Plan gate
  if (!tenantPlan || !hasPlatformIntegrations(tenantPlan)) {
    return (
      <div>
        <PageHeader
          title="Dropshipping Listings"
          description="Manage your active eBay listings and link supplier source products"
        />
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h2 className="text-sm font-semibold text-[var(--color-text-strong)]">
            Upgrade to unlock Dropshipping
          </h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Dropshipping listing management is available on the Pro and Business plans.
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-4 inline-block text-sm font-medium text-[var(--color-primary)] hover:underline"
          >
            View plans &amp; billing →
          </Link>
        </div>
      </div>
    );
  }

  // 2. eBay connection guard
  const ebayConnection = connections.find((c) => c.platform === "ebay");
  if (!ebayConnection || ebayConnection.status !== "connected") {
    return (
      <div>
        <PageHeader
          title="Dropshipping Listings"
          description="Manage your active eBay listings and link supplier source products"
        />
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h2 className="text-sm font-semibold text-[var(--color-text-strong)]">
            eBay connection required
          </h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Connect your eBay seller account in Integrations to import your active listings.
          </p>
          <Link
            href="/dashboard/integrations"
            className="mt-4 inline-block text-sm font-medium text-[var(--color-primary)] hover:underline"
          >
            Go to Integrations →
          </Link>
        </div>
      </div>
    );
  }

  const canRefresh = role && hasPermission(role, "manage_integrations");

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/dropshipping/listings/refresh", { method: "POST" });
      const json = (await res.json()) as { synced?: number; error?: string };

      if (!res.ok) {
        throw new Error(json.error ?? "Refresh failed");
      }

      // Re-fetch all listings to get the updated rows (with created_at, ids, etc.)
      const listingsRes = await fetch("/api/dropshipping/listings");
      if (listingsRes.ok) {
        const updated = (await listingsRes.json()) as DropshipListing[];
        dispatch(upsertListings(updated));
      }

      addToast({
        type: "success",
        message: `Synced ${json.synced ?? 0} listing${json.synced === 1 ? "" : "s"} from eBay.`,
      });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Refresh failed",
      });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Dropshipping Listings"
        description="Active eBay listings with linked supplier source products"
        actions={
          canRefresh ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Refreshing…" : "Refresh from eBay"}
            </Button>
          ) : undefined
        }
      />

      <ListingsTable listings={listings} />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/dropshipping/
git commit -m "feat(dropshipping): add ListingsTable, EditSourceModal, and page"
```

---

### Task 9: Feature Docs + Final Commit

**Files:**
- Create: `src/app/dashboard/dropshipping/CLAUDE.md`
- Create: `src/app/dashboard/dropshipping/SKILL.md`

- [ ] **Step 1: Create `CLAUDE.md`**

Create `src/app/dashboard/dropshipping/CLAUDE.md`:

```markdown
# Dropshipping feature

Route: `/dashboard/dropshipping`. Shows a tenant's active eBay listings fetched via their
existing eBay OAuth connection, stored in `public.dropship_listings`. Each listing can be
linked to an Amazon or AliExpress supplier URL. Listings refresh on demand via "Refresh
from eBay" (admin/super_admin only). Available on Pro/Business plans only.

## Files in this folder

- `page.tsx` — `"use client"`. Three render branches: plan gate → eBay connection guard → listings page.
  Plan gate links to `/dashboard/settings`. Connection guard links to `/dashboard/integrations`.
  "Refresh from eBay" button visible only to admin/super_admin (checks `hasPermission(role, "manage_integrations")`).
  After refresh: re-fetches full listing list via `GET /api/dropshipping/listings` and dispatches `upsertListings`.
- `_components/ListingsTable.tsx` — shadcn `Table`. Columns: image (48×48 with fallback ImageIcon),
  title (linked to eBay listing, new tab), price (`formatCurrency`), SKU (dash if null),
  source (platform badge + truncated URL), Edit button (opens `EditSourceModal`).
  Empty state card when `listings.length === 0`.
- `_components/EditSourceModal.tsx` — shadcn `Dialog`. URL input with live `PlatformBadge`
  (Amazon/AliExpress/Unknown based on `detectPlatform`). On save: `PATCH /api/dropshipping/listings/[id]`,
  dispatches `updateListingSource`, toasts success.
- `_store/dropshippingSlice.ts` — `state.dropshipping.listings: DropshipListing[]`.
  Actions: `hydrateListings` (full replace), `upsertListings` (replace-or-append by
  `ebay_listing_id`, preserves `source_url`/`source_platform`), `updateListingSource`
  (updates by `id`).
- `_store/dropshippingSlice.test.ts` — 5 tests covering all three reducers.

## API routes

- `GET /api/dropshipping/listings` — reads all rows ordered by `created_at DESC`. All
  authenticated users. Used by `dashboard/layout.tsx` for hydration and by `page.tsx` after refresh.
- `POST /api/dropshipping/listings/refresh` — `requireIntegrationAdmin` guard; fetches
  from eBay via `fetchActiveListings(accessToken)` (2 API calls: GET /offer + GET /inventory_item);
  upserts to `dropship_listings` with `onConflict: "ebay_listing_id"` (never overwrites
  `source_url`/`source_platform`). Returns `{ synced: number }`.
- `PATCH /api/dropshipping/listings/[id]` — all authenticated users; validates `sourceUrl`,
  calls `detectPlatform`, updates row. Returns updated `DropshipListing`.

## eBay API notes

- Scope: `sell.inventory.readonly` (added to `EBAY_SCOPE` in `src/lib/integrations/ebay.ts`
  alongside `sell.fulfillment`). Existing connections authorised before this scope was added
  **must be re-authorised** — the refresh route returns a user-readable 403 error if not.
- `fetchActiveListings` is in `src/lib/integrations/ebay/listings.ts`. It fetches
  `/sell/inventory/v1/offer?limit=200` (active offers) and `/sell/inventory/v1/inventory_item?limit=200`
  (title + images) in parallel, joins by SKU.

## Data flow

`dashboard/layout.tsx` fetches `dropship_listings` and passes to `StoreProvider` as
`dropshipListings`; `StoreProvider` dispatches `hydrateListings`. `page.tsx` reads from
Redux only — no direct Supabase calls on the client.

## Shared dependencies

- `src/lib/utils/detectPlatform` — `detectPlatform(url)`
- `src/lib/utils/planGating` — `hasPlatformIntegrations`
- `src/lib/utils/permissions` — `hasPermission`, `manage_integrations`
- `src/lib/utils/currency` — `formatCurrency`
- `src/lib/utils` — `cn()`
- `src/lib/integrations/ebay/listings.ts` — `fetchActiveListings` (server-only)
- `src/lib/integrations/authGuard` — `requireIntegrationAdmin`
- `src/lib/integrations/tokenStore` — `getConnection`, `ensureValidAccessToken`
- `src/components/layout/PageHeader`
- `src/components/ui/Button` — existing custom Button (never use shadcn add button)
- shadcn: `table`, `dialog`, `input` (in `src/components/ui/`)
- `src/components/ui/Toast` — `useToast`
- `src/store/hooks` — `useAppSelector`, `useAppDispatch`
- `src/store/slices/currentUserSlice` — `profile.role`, `tenantPlan`
- `src/types` — `DropshipListing`, `SourcePlatform`

## Tests

`npx jest dashboard/dropshipping detectPlatform`
```

- [ ] **Step 2: Create `SKILL.md`**

Create `src/app/dashboard/dropshipping/SKILL.md`:

```markdown
# Dropshipping — Agent Playbook

## Minimal file set per change type

| Change | Files to touch |
|---|---|
| Add a column to `dropship_listings` | `supabase/009_dropship_listings.sql` (new migration), `src/types/index.ts` (`DropshipListing`), `_store/dropshippingSlice.ts` (if reducer needs updating), API routes that upsert |
| Change source platform detection logic | `src/lib/utils/detectPlatform.ts` + its test |
| Add a new column to the listings table | `_components/ListingsTable.tsx` — add `TableHead` + `TableCell` |
| Change eBay listing fields fetched | `src/lib/integrations/ebay/listings.ts` → update `EbayOffer`/`EbayInventoryItem` interfaces and mapping |
| Add an action to the Redux slice | `_store/dropshippingSlice.ts` + `_store/dropshippingSlice.test.ts` |
| Change refresh logic | `src/app/api/dropshipping/listings/refresh/route.ts` |
| Change source URL editing | `_components/EditSourceModal.tsx` + PATCH route |
| Update docs | `CLAUDE.md` (file map / data flow), `SKILL.md` (this file) |

## Gotchas

- **`source_url`/`source_platform` preservation on refresh:** `upsertListings` Redux action
  deliberately preserves existing `source_url`/`source_platform` from the current state when
  the same `ebay_listing_id` is re-fetched. The DB upsert does NOT include those columns in the
  upserted payload, so the DB also preserves them. Both layers independently protect supplier links.

- **eBay scope re-authorization:** The `sell.inventory.readonly` scope was added after some
  connections were created. If `fetchActiveListings` throws "eBay returned 403 Forbidden",
  the user must disconnect and reconnect eBay in `/dashboard/integrations` to get the new scope.

- **Button.tsx naming conflict:** macOS case-insensitive filesystem means `Button.tsx` and
  `button.tsx` resolve to the same file. **Never run `npx shadcn add button`** — it will
  overwrite the custom Button with a different variant API. Use `@/components/ui/Button`
  (variants: `"primary"/"secondary"/"danger"/"ghost"`).

- **Refresh is admin/super_admin only:** The "Refresh from eBay" button is hidden from
  accountants in the UI via `hasPermission(role, "manage_integrations")`. The
  `POST /api/dropshipping/listings/refresh` route uses `requireIntegrationAdmin()` which
  enforces the same check at the API level.

- **No pagination in Phase 1:** `fetchActiveListings` fetches up to 200 offers and 200
  inventory items. Sellers with > 200 active listings will not see all of them. Pagination
  is a Phase 2 concern.

- **`formatCurrency` currency arg:** `formatCurrency(price, currency)` — always pass the
  `currency` field from the listing row (not hardcoded EUR), since sellers may list in GBP,
  USD, etc.

- **shadcn `dark:` variants don't work:** The project uses `[data-theme="dark"]` on `<html>`,
  not a `.dark` class. Any `dark:` Tailwind variants in shadcn components will not respond
  to the theme toggle. Use `var(--color-*)` CSS variables or the mapped shadcn tokens
  (`bg-card`, `text-muted-foreground`, etc.) which cascade correctly.
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/dropshipping/CLAUDE.md src/app/dashboard/dropshipping/SKILL.md
git commit -m "docs(dropshipping): add CLAUDE.md and SKILL.md for dropshipping feature"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Fetch active eBay listings via existing OAuth — Task 5 + 6 (refresh route)
- ✅ Store in DB — Task 1 (`dropship_listings` table) + Task 6 (upsert on refresh)
- ✅ Show in shadcn table (image, title, price, SKU, source) — Task 8 (`ListingsTable`)
- ✅ Link to Amazon/AliExpress URL (auto-detected) — Tasks 2, 6, 8
- ✅ Edit button to update source URL — Task 8 (`EditSourceModal`)
- ✅ No delete — Tasks 1 (no DELETE policy), 8 (no delete UI)
- ✅ "Refresh from eBay" button — Task 8 (page.tsx), Task 6 (refresh route)
- ✅ Pro/Business plan gate — Task 8 (page.tsx)
- ✅ Redirect to /dashboard/integrations if eBay not connected — Task 8 (page.tsx)
- ✅ shadcn for all UI — Tasks 7 + 8
- ✅ Redux slice with correct actions — Task 3
- ✅ Store wiring + layout hydration — Task 4
- ✅ Sidebar entry with Package icon — Task 4
- ✅ Tests for slice and detectPlatform — Tasks 2 + 3
- ✅ Feature docs — Task 9

**Type consistency check:**
- `DropshipListing` (Task 1) → used in `dropshippingSlice.ts` (Task 3) ✅
- `EbayListing` (Task 5) → mapped to DB row in refresh route (Task 6) ✅
- `fetchActiveListings` signature in Task 5 → called in Task 6 ✅
- `updateListingSource({ id, sourceUrl, sourcePlatform })` defined in Task 3 → called in Task 8 ✅
- `upsertListings(DropshipListing[])` defined in Task 3 → called in Task 8 ✅
