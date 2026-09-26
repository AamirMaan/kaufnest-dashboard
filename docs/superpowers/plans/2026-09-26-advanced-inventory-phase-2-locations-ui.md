# Advanced Inventory — Phase 2 (Enable Flow + Locations UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Business/trial tenants the first visible piece of advanced inventory: an "Enable batches & locations" flow, an Inventory page with Products/Locations tabs, location management, and per-platform fulfillment defaults.

**Architecture:** A new feature-private Redux slice (`state.advancedInventory`) loads `inventory_settings`, `stock_locations` and `platform_location_defaults` client-side via `createTenantClient()` — only when the plan allows it, from the Inventory page (not the dashboard layout, so no other page pays for it). All view decisions (upsell / enable / active), sorting, option filtering, validation and diffing live in a pure `_lib/advancedInventory.ts` with colocated tests; components are thin. Writes go straight to the tables (RLS: admin-only for locations/defaults) or through the Phase 1 RPC `set_default_location` and route `POST /api/inventory/enable-advanced`; every trigger/RPC error goes through `inventoryErrorMessage()`.

**Tech Stack:** Next.js App Router (client components), Redux Toolkit, Supabase JS, Tailwind tokens, lucide-react, Jest.

**Spec:** `docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md` (sections "Plan gating", "UI → Inventory page", "Audit").
**Builds on:** Phase 1 (PR AamirMaan/kaufnest-dashboard#109, branch `feat/advanced-inventory`). This branch, `feat/advanced-inventory-phase-2`, is stacked on it.

## Global Constraints

- Branch `feat/advanced-inventory-phase-2` (stacked on `feat/advanced-inventory`). Never commit to `main`.
- Advanced UI shows only when `hasAdvancedInventory(plan)` AND `inventory_settings.advanced_enabled`. Starter/Pro see today's Inventory page plus an upsell card; Business/trial with the flag off see today's page plus an enable card (Enable button for `admin`/`super_admin` only).
- Enabling is one-way; the confirm modal must say so. It calls `POST /api/inventory/enable-advanced` (200 `{ ok: true }` or `{ error }`).
- Writes to `stock_locations`, `platform_location_defaults` and `set_default_location` are admin-only (RLS/RPC). Non-admins get a read-only Locations tab.
- Never show a raw Postgres error: use `inventoryErrorMessage(err, fallback)` from `@/lib/inventory/inventoryErrors`; unique-name violations (`code === "23505"`) show "A location with this name already exists."
- Default location must be active and not `dropship`. Platform defaults may point at any location, including dropship.
- Every mutation: toast on success AND failure; `writeAuditLog` + `dispatch(addAuditLog(...))`. Entity types: `"stock_location"` for location CRUD, `"inventory_settings"` (new in this plan) for enable + fulfillment defaults.
- Form conventions (AGENTS.md "Form conventions"): real `<form id>`, `required` on both `<Field required>` and the control, submit `type="submit" form="<id>"`, `disabled={saving || !isFormValid}`, busy verb ("Saving…", "Enabling…"), Cancel button, Escape/backdrop close (Modal does this).
- UI conventions: atoms from `@/components/ui/*`, tokens only (`var(--color-*)`, `rounded-(--radius-card)`, `rounded-(--radius-btn)`), one primary button per view, `text-base font-semibold` card headings, `text-sm` body, `text-xs` meta, every `DataTable` has `emptyMessage`, every icon-only button has `title` + `aria-label`.
- Supabase query checklist: `stock_locations` is user-created → read with `fetchAllRows` (cap `STOCK_LOCATIONS_CAP = 1000`); `platform_location_defaults` is structurally bounded by its primary key (one row per `Platform`, 5 max) — say so in a comment; `inventory_settings` is a singleton (`.maybeSingle()`).
- Pure logic lives in `_lib/` with colocated tests; this project does not unit-test React components (no `*.test.tsx` exist). Verify UI with the Playwright MCP only if it is connected AND `npm run dev` is already running; never start the dev server yourself.
- Run only focused `npx jest <path>`; don't run tsc/lint by hand (pre-commit does). Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Live-data prerequisite (for manual QA only, not for tests):** existing tenants get the Phase 1 tables only after `048_advanced_inventory_apply.sql` is applied (after PR #109 merges). Until then the Business/trial view on an existing tenant shows the load-error card with Retry — that is the designed fallback, not a bug.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/types/index.ts` (modify) | `PlatformLocationDefault` type; `AuditEntity` gains `"inventory_settings"` |
| `src/app/dashboard/inventory/_lib/advancedInventory.ts` (+ test) | Pure: labels/constants, `advancedInventoryView`, sorting, option filters, name check, deactivation blocker, fulfillment-defaults draft/diff/validation |
| `src/app/dashboard/inventory/_store/advancedInventorySlice.ts` (+ test) | `state.advancedInventory`: settings, locations, platform defaults, load state; `fetchAdvancedInventory` thunk |
| `src/store/store.ts` (modify) | Register the slice |
| `src/app/dashboard/inventory/_components/InventoryTabs.tsx` | Accessible tab strip (Products / Locations) |
| `src/app/dashboard/inventory/_components/ProductsTab.tsx` | Today's products table, search, pagination, product modals — moved out of `page.tsx` unchanged |
| `src/app/dashboard/inventory/_components/AdvancedInventoryUpsellCard.tsx` | Starter/Pro upsell |
| `src/app/dashboard/inventory/_components/EnableAdvancedCard.tsx` | Enable card + one-way confirm modal + route call + audit |
| `src/app/dashboard/inventory/_components/LocationModal.tsx` | Add/edit location form |
| `src/app/dashboard/inventory/_components/LocationsTab.tsx` | Locations table, deactivate/reactivate, delete, hosts fulfillment defaults |
| `src/app/dashboard/inventory/_components/FulfillmentDefaultsCard.tsx` | Default location + per-platform default location form |
| `src/app/dashboard/inventory/page.tsx` (modify) | Composes the views and tabs |
| Docs (modify) | `inventory/CLAUDE.md`, `inventory/SKILL.md`, spec phasing note |

---

### Task 1: Pure advanced-inventory logic

**Files:**
- Modify: `src/types/index.ts` (after `StockTransfer`; `AuditEntity`)
- Create: `src/app/dashboard/inventory/_lib/advancedInventory.ts`
- Test: `src/app/dashboard/inventory/_lib/advancedInventory.test.ts`

**Interfaces:**
- Consumes: `hasAdvancedInventory(plan)` (`@/lib/utils/planGating`), types `InventorySettings`, `StockLocation`, `StockLocationType`, `Platform`, `TenantPlan` (Phase 1).
- Produces: `PlatformLocationDefault { platform: Platform; location_id: string }`; `LOCATION_TYPES`, `LOCATION_TYPE_LABELS`, `INVENTORY_PLATFORMS`, `PLATFORM_LABELS`; `type AdvancedInventoryView = "upsell" | "loading" | "error" | "enable" | "active"`; `advancedInventoryView(plan, load)`; `sortLocations`; `defaultLocationOptions`; `platformLocationOptions`; `isLocationNameTaken`; `locationDeactivationBlocker`; `type FulfillmentDraft`; `fulfillmentDraftFrom`; `platformDefaultChanges`; `isFulfillmentDraftValid`; `isFulfillmentDraftDirty`.

- [ ] **Step 1: Add the types** — in `src/types/index.ts`, after `interface StockTransfer { … }` add:

```ts
export interface PlatformLocationDefault {
  platform: Platform;
  location_id: string;
}
```

and change `AuditEntity` to:

```ts
export type AuditEntity = "expense" | "purchase" | "sale" | "user" | "product" | "message" | "shipment" | "stock_location" | "stock_transfer" | "inventory_settings";
```

- [ ] **Step 2: Write the failing test** — `src/app/dashboard/inventory/_lib/advancedInventory.test.ts`:

```ts
import {
  advancedInventoryView,
  sortLocations,
  defaultLocationOptions,
  platformLocationOptions,
  isLocationNameTaken,
  locationDeactivationBlocker,
  fulfillmentDraftFrom,
  platformDefaultChanges,
  isFulfillmentDraftValid,
  isFulfillmentDraftDirty,
  INVENTORY_PLATFORMS,
  LOCATION_TYPE_LABELS,
} from "./advancedInventory";
import type { InventorySettings, PlatformLocationDefault, StockLocation } from "@/types";

const loc = (id: string, overrides: Partial<StockLocation> = {}): StockLocation => ({
  id,
  name: id.toUpperCase(),
  type: "own",
  is_active: true,
  created_by: null,
  created_at: "2026-09-26T00:00:00.000Z",
  ...overrides,
});

const settings = (overrides: Partial<InventorySettings> = {}): InventorySettings => ({
  advanced_enabled: true,
  enabled_at: "2026-09-26T00:00:00.000Z",
  default_location_id: "main",
  ...overrides,
});

const allDefaults = (locationId: string): PlatformLocationDefault[] =>
  INVENTORY_PLATFORMS.map((platform) => ({ platform, location_id: locationId }));

describe("advancedInventoryView", () => {
  const idle = { loaded: false, loading: false, error: null, settings: null };

  it("shows the upsell for plans without advanced inventory, and when the plan is unknown", () => {
    expect(advancedInventoryView("starter", idle)).toBe("upsell");
    expect(advancedInventoryView("pro", { ...idle, loaded: true, settings: settings() })).toBe("upsell");
    expect(advancedInventoryView(null, idle)).toBe("upsell");
  });

  it("is loading until the first fetch completes", () => {
    expect(advancedInventoryView("business", idle)).toBe("loading");
    expect(advancedInventoryView("business", { ...idle, loading: true })).toBe("loading");
  });

  it("reports a load error", () => {
    expect(advancedInventoryView("business", { ...idle, error: "boom" })).toBe("error");
  });

  it("offers enabling when the flag is off or the settings row is missing", () => {
    expect(advancedInventoryView("business", { ...idle, loaded: true, settings: settings({ advanced_enabled: false }) })).toBe("enable");
    expect(advancedInventoryView("trial", { ...idle, loaded: true, settings: null })).toBe("enable");
  });

  it("is active once enabled on business or trial", () => {
    expect(advancedInventoryView("business", { ...idle, loaded: true, settings: settings() })).toBe("active");
    expect(advancedInventoryView("trial", { ...idle, loaded: true, settings: settings() })).toBe("active");
  });
});

describe("sortLocations", () => {
  it("puts active locations first, then sorts by name case-insensitively", () => {
    const sorted = sortLocations([
      loc("b", { name: "beta" }),
      loc("z", { name: "Alpha", is_active: false }),
      loc("a", { name: "Amazon FBA" }),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(["a", "b", "z"]);
  });

  it("does not mutate its input", () => {
    const input = [loc("b", { name: "B" }), loc("a", { name: "A" })];
    sortLocations(input);
    expect(input.map((l) => l.id)).toEqual(["b", "a"]);
  });
});

describe("defaultLocationOptions", () => {
  it("keeps only active, stock-holding locations", () => {
    const options = defaultLocationOptions([
      loc("main"),
      loc("ds", { type: "dropship" }),
      loc("old", { is_active: false }),
      loc("fba", { type: "fba", name: "Amazon FBA" }),
    ]);
    expect(options.map((l) => l.id)).toEqual(["fba", "main"]);
  });
});

describe("platformLocationOptions", () => {
  it("offers active locations of any type, plus the currently selected one even if inactive", () => {
    const locations = [loc("main"), loc("ds", { type: "dropship" }), loc("old", { is_active: false })];
    expect(platformLocationOptions(locations, null).map((l) => l.id)).toEqual(["ds", "main"]);
    expect(platformLocationOptions(locations, "old").map((l) => l.id)).toEqual(["ds", "main", "old"]);
  });
});

describe("isLocationNameTaken", () => {
  const locations = [loc("main", { name: "Main" }), loc("fba", { name: "Amazon FBA" })];

  it("matches trimmed names case-insensitively", () => {
    expect(isLocationNameTaken("  main ", locations)).toBe(true);
    expect(isLocationNameTaken("Warehouse 2", locations)).toBe(false);
  });

  it("ignores the location being edited", () => {
    expect(isLocationNameTaken("Main", locations, "main")).toBe(false);
  });
});

describe("locationDeactivationBlocker", () => {
  it("blocks deactivating the default location", () => {
    expect(locationDeactivationBlocker(loc("main"), settings())).toBe(
      "This is the default location. Choose another default location first.",
    );
  });

  it("allows any other location, and allows reactivation", () => {
    expect(locationDeactivationBlocker(loc("fba"), settings())).toBeNull();
    expect(locationDeactivationBlocker(loc("main", { is_active: false }), settings())).toBeNull();
  });
});

describe("fulfillment defaults draft", () => {
  const locations = [loc("main"), loc("fba", { type: "fba" }), loc("ds", { type: "dropship" })];

  it("builds a draft from settings and platform defaults, blank for unmapped platforms", () => {
    const draft = fulfillmentDraftFrom(settings(), [{ platform: "amazon", location_id: "fba" }]);
    expect(draft.defaultLocationId).toBe("main");
    expect(draft.platforms.amazon).toBe("fba");
    expect(draft.platforms.ebay).toBe("");
  });

  it("lists only changed platform rows", () => {
    const current = allDefaults("main");
    const draft = fulfillmentDraftFrom(settings(), current);
    draft.platforms.amazon = "fba";
    draft.platforms.other = "ds";
    expect(platformDefaultChanges(current, draft)).toEqual([
      { platform: "amazon", location_id: "fba" },
      { platform: "other", location_id: "ds" },
    ]);
  });

  it("is valid when the default is an active stock-holding location and every platform is mapped", () => {
    const draft = fulfillmentDraftFrom(settings(), allDefaults("main"));
    expect(isFulfillmentDraftValid(draft, locations)).toBe(true);
    draft.platforms.etsy = "ds";
    expect(isFulfillmentDraftValid(draft, locations)).toBe(true);
  });

  it("is invalid with a dropship default or an unmapped platform", () => {
    const draft = fulfillmentDraftFrom(settings({ default_location_id: "ds" }), allDefaults("main"));
    expect(isFulfillmentDraftValid(draft, locations)).toBe(false);
    const draft2 = fulfillmentDraftFrom(settings(), allDefaults("main"));
    draft2.platforms.shopify = "";
    expect(isFulfillmentDraftValid(draft2, locations)).toBe(false);
  });

  it("detects whether anything changed", () => {
    const current = allDefaults("main");
    const draft = fulfillmentDraftFrom(settings(), current);
    expect(isFulfillmentDraftDirty(settings(), current, draft)).toBe(false);
    draft.defaultLocationId = "fba";
    expect(isFulfillmentDraftDirty(settings(), current, draft)).toBe(true);
  });
});

describe("labels", () => {
  it("labels every location type", () => {
    expect(LOCATION_TYPE_LABELS).toEqual({
      own: "Own warehouse",
      fba: "Amazon FBA",
      "3pl": "3PL warehouse",
      dropship: "Dropship supplier",
    });
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (module not found)

Run: `npx jest src/app/dashboard/inventory/_lib/advancedInventory.test.ts`

- [ ] **Step 4: Implement** — `src/app/dashboard/inventory/_lib/advancedInventory.ts`:

```ts
import type {
  InventorySettings,
  Platform,
  PlatformLocationDefault,
  StockLocation,
  StockLocationType,
  TenantPlan,
} from "@/types";
import { hasAdvancedInventory } from "@/lib/utils/planGating";

/**
 * Pure logic behind the advanced-inventory (batches & locations) UI. Every
 * decision the Inventory page and its Locations tab make lives here so it is
 * unit-tested without rendering. See
 * docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md.
 */

export const LOCATION_TYPES: StockLocationType[] = ["own", "fba", "3pl", "dropship"];

export const LOCATION_TYPE_LABELS: Record<StockLocationType, string> = {
  own: "Own warehouse",
  fba: "Amazon FBA",
  "3pl": "3PL warehouse",
  dropship: "Dropship supplier",
};

/** Same order and values as sales' PLATFORMS and the DB CHECK on platform_location_defaults. */
export const INVENTORY_PLATFORMS: Platform[] = ["amazon", "ebay", "etsy", "shopify", "other"];

export const PLATFORM_LABELS: Record<Platform, string> = {
  amazon: "Amazon",
  ebay: "eBay",
  etsy: "Etsy",
  shopify: "Shopify",
  other: "Other",
};

export type AdvancedInventoryView = "upsell" | "loading" | "error" | "enable" | "active";

export interface AdvancedInventoryLoadState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  settings: InventorySettings | null;
}

/**
 * Which Inventory page to show. Fails closed: an unknown plan is treated as
 * not entitled, and nothing advanced renders until settings have loaded.
 * A downgraded tenant with the flag still on sees the upsell — the ledger
 * keeps running in the database, only the UI is hidden.
 */
export function advancedInventoryView(
  plan: TenantPlan | null,
  load: AdvancedInventoryLoadState,
): AdvancedInventoryView {
  if (!plan || !hasAdvancedInventory(plan)) return "upsell";
  if (load.error) return "error";
  if (!load.loaded) return "loading";
  return load.settings?.advanced_enabled ? "active" : "enable";
}

function byName(a: StockLocation, b: StockLocation): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Active locations first, then alphabetical. Returns a new array. */
export function sortLocations(locations: StockLocation[]): StockLocation[] {
  return [...locations].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return byName(a, b);
  });
}

/** Candidates for the tenant's default location: active and able to hold stock. */
export function defaultLocationOptions(locations: StockLocation[]): StockLocation[] {
  return locations.filter((l) => l.is_active && l.type !== "dropship").sort(byName);
}

/**
 * Candidates for a platform's default fulfillment location: any active
 * location (dropship included — e.g. "all Etsy orders ship from the
 * supplier"), plus the currently selected one even if it has since been
 * deactivated, so the select can still display it.
 */
export function platformLocationOptions(
  locations: StockLocation[],
  currentId: string | null,
): StockLocation[] {
  return locations.filter((l) => l.is_active || l.id === currentId).sort(byName);
}

/** Mirrors the DB's unique index on lower(name). */
export function isLocationNameTaken(
  name: string,
  locations: StockLocation[],
  exceptId?: string,
): boolean {
  const wanted = name.trim().toLowerCase();
  return locations.some((l) => l.id !== exceptId && l.name.trim().toLowerCase() === wanted);
}

/**
 * Why a location can't be deactivated right now, or null if it can. Mirrors
 * the DB guard (INV_DEFAULT_LOCATION) so the UI can explain before asking.
 */
export function locationDeactivationBlocker(
  location: StockLocation,
  settings: InventorySettings | null,
): string | null {
  if (location.is_active && settings?.default_location_id === location.id) {
    return "This is the default location. Choose another default location first.";
  }
  return null;
}

export interface FulfillmentDraft {
  defaultLocationId: string;
  platforms: Record<Platform, string>;
}

export function fulfillmentDraftFrom(
  settings: InventorySettings | null,
  defaults: PlatformLocationDefault[],
): FulfillmentDraft {
  const platforms = Object.fromEntries(INVENTORY_PLATFORMS.map((p) => [p, ""])) as Record<Platform, string>;
  for (const d of defaults) platforms[d.platform] = d.location_id;
  return { defaultLocationId: settings?.default_location_id ?? "", platforms };
}

/** Platform rows whose location differs from what is stored, in INVENTORY_PLATFORMS order. */
export function platformDefaultChanges(
  current: PlatformLocationDefault[],
  draft: FulfillmentDraft,
): PlatformLocationDefault[] {
  const stored = new Map(current.map((d) => [d.platform, d.location_id]));
  return INVENTORY_PLATFORMS
    .filter((p) => draft.platforms[p] !== "" && draft.platforms[p] !== stored.get(p))
    .map((p) => ({ platform: p, location_id: draft.platforms[p] }));
}

export function isFulfillmentDraftValid(draft: FulfillmentDraft, locations: StockLocation[]): boolean {
  const defaultOk = defaultLocationOptions(locations).some((l) => l.id === draft.defaultLocationId);
  const ids = new Set(locations.map((l) => l.id));
  const platformsOk = INVENTORY_PLATFORMS.every((p) => ids.has(draft.platforms[p]));
  return defaultOk && platformsOk;
}

export function isFulfillmentDraftDirty(
  settings: InventorySettings | null,
  current: PlatformLocationDefault[],
  draft: FulfillmentDraft,
): boolean {
  return (
    draft.defaultLocationId !== (settings?.default_location_id ?? "") ||
    platformDefaultChanges(current, draft).length > 0
  );
}
```

- [ ] **Step 5: Run it — expect PASS**

Run: `npx jest src/app/dashboard/inventory/_lib/advancedInventory.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/app/dashboard/inventory/_lib/advancedInventory.ts src/app/dashboard/inventory/_lib/advancedInventory.test.ts
git commit -m "feat(inventory): pure view, option and validation logic for batches & locations UI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: advancedInventory slice

**Files:**
- Create: `src/app/dashboard/inventory/_store/advancedInventorySlice.ts`
- Test: `src/app/dashboard/inventory/_store/advancedInventorySlice.test.ts`
- Modify: `src/store/store.ts`

**Interfaces:**
- Consumes: `createTenantClient` (`@/lib/supabase/client`), `fetchAllRows` (`@/lib/utils/fetchAllRows`), `inventoryErrorMessage` (`@/lib/inventory/inventoryErrors`), types from Task 1.
- Produces: `advancedInventorySlice` (reducer key `advancedInventory`); `STOCK_LOCATIONS_CAP = 1000`; thunk `fetchAdvancedInventory()` → `{ settings: InventorySettings | null; locations: StockLocation[]; platformDefaults: PlatformLocationDefault[] }`; actions `locationSaved(StockLocation)`, `locationRemoved(id: string)`, `settingsSet(InventorySettings)`, `platformDefaultsMerged(PlatformLocationDefault[])`; state `{ settings, locations, platformDefaults, loaded, loading, error }`.

- [ ] **Step 1: Write the failing test** — `advancedInventorySlice.test.ts`:

```ts
import {
  advancedInventorySlice,
  fetchAdvancedInventory,
  locationSaved,
  locationRemoved,
  settingsSet,
  platformDefaultsMerged,
} from "./advancedInventorySlice";
import type { InventorySettings, StockLocation } from "@/types";

const { reducer } = advancedInventorySlice;

const loc = (id: string, overrides: Partial<StockLocation> = {}): StockLocation => ({
  id,
  name: id,
  type: "own",
  is_active: true,
  created_by: null,
  created_at: "2026-09-26T00:00:00.000Z",
  ...overrides,
});

const settings: InventorySettings = {
  advanced_enabled: true,
  enabled_at: "2026-09-26T00:00:00.000Z",
  default_location_id: "main",
};

describe("advancedInventorySlice", () => {
  it("starts empty and not loaded", () => {
    expect(reducer(undefined, { type: "@@INIT" })).toEqual({
      settings: null,
      locations: [],
      platformDefaults: [],
      loaded: false,
      loading: false,
      error: null,
    });
  });

  it("tracks the fetch lifecycle", () => {
    const pending = reducer(undefined, { type: fetchAdvancedInventory.pending.type });
    expect(pending.loading).toBe(true);
    expect(pending.error).toBeNull();

    const payload = {
      settings,
      locations: [loc("main")],
      platformDefaults: [{ platform: "ebay", location_id: "main" }],
    };
    const done = reducer(pending, { type: fetchAdvancedInventory.fulfilled.type, payload });
    expect(done).toEqual({ ...payload, loaded: true, loading: false, error: null });
  });

  it("stores the rejection message and clears loading", () => {
    const pending = reducer(undefined, { type: fetchAdvancedInventory.pending.type });
    const failed = reducer(pending, {
      type: fetchAdvancedInventory.rejected.type,
      error: { message: "Could not load batches & locations." },
    });
    expect(failed.loading).toBe(false);
    expect(failed.loaded).toBe(false);
    expect(failed.error).toBe("Could not load batches & locations.");
  });

  it("falls back to a generic error when the rejection has no message", () => {
    const failed = reducer(undefined, { type: fetchAdvancedInventory.rejected.type, error: {} });
    expect(failed.error).toBe("Could not load batches & locations.");
  });

  it("inserts a new location and replaces an edited one", () => {
    let state = reducer(undefined, locationSaved(loc("main")));
    state = reducer(state, locationSaved(loc("fba", { type: "fba" })));
    state = reducer(state, locationSaved(loc("main", { name: "Main warehouse" })));
    expect(state.locations.map((l) => [l.id, l.name])).toEqual([
      ["main", "Main warehouse"],
      ["fba", "fba"],
    ]);
  });

  it("removes a location", () => {
    const state = reducer(reducer(undefined, locationSaved(loc("main"))), locationRemoved("main"));
    expect(state.locations).toEqual([]);
  });

  it("replaces settings", () => {
    const state = reducer(undefined, settingsSet(settings));
    expect(state.settings).toEqual(settings);
  });

  it("merges platform defaults by platform", () => {
    let state = reducer(undefined, platformDefaultsMerged([
      { platform: "ebay", location_id: "main" },
      { platform: "amazon", location_id: "main" },
    ]));
    state = reducer(state, platformDefaultsMerged([{ platform: "amazon", location_id: "fba" }]));
    expect(state.platformDefaults).toEqual([
      { platform: "ebay", location_id: "main" },
      { platform: "amazon", location_id: "fba" },
    ]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx jest src/app/dashboard/inventory/_store/advancedInventorySlice.test.ts`

- [ ] **Step 3: Implement** — `advancedInventorySlice.ts`:

```ts
import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { InventorySettings, PlatformLocationDefault, StockLocation } from "@/types";
import { createTenantClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/utils/fetchAllRows";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";

/**
 * Batches & locations settings for the Inventory page (Business/trial only).
 * Loaded on demand by the Inventory page — not by dashboard/layout.tsx — so
 * no other page and no Starter/Pro tenant pays for these queries.
 */

/** stock_locations grows with the tenant (user-created), so it is read with fetchAllRows. */
export const STOCK_LOCATIONS_CAP = 1000;

const LOAD_ERROR = "Could not load batches & locations.";

interface AdvancedInventoryState {
  settings: InventorySettings | null;
  locations: StockLocation[];
  platformDefaults: PlatformLocationDefault[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: AdvancedInventoryState = {
  settings: null,
  locations: [],
  platformDefaults: [],
  loaded: false,
  loading: false,
  error: null,
};

export const fetchAdvancedInventory = createAsyncThunk("advancedInventory/fetch", async () => {
  const supabase = await createTenantClient();
  const [settingsRes, defaultsRes, locations] = await Promise.all([
    // Singleton row (primary key id = true).
    supabase
      .from("inventory_settings")
      .select("advanced_enabled, enabled_at, default_location_id")
      .maybeSingle<InventorySettings>(),
    // Structurally bounded: platform is the primary key, one row per Platform (5 max).
    supabase.from("platform_location_defaults").select("platform, location_id"),
    fetchAllRows<StockLocation>(
      (from, to) =>
        supabase
          .from("stock_locations")
          .select("*", { count: "exact" })
          .order("name", { ascending: true })
          .range(from, to),
      STOCK_LOCATIONS_CAP,
    ),
  ]);
  if (settingsRes.error) throw new Error(inventoryErrorMessage(settingsRes.error, LOAD_ERROR));
  if (defaultsRes.error) throw new Error(inventoryErrorMessage(defaultsRes.error, LOAD_ERROR));
  return {
    settings: settingsRes.data ?? null,
    locations,
    platformDefaults: (defaultsRes.data ?? []) as PlatformLocationDefault[],
  };
});

export const advancedInventorySlice = createSlice({
  name: "advancedInventory",
  initialState,
  reducers: {
    locationSaved(state, action: PayloadAction<StockLocation>) {
      const idx = state.locations.findIndex((l) => l.id === action.payload.id);
      if (idx === -1) state.locations.push(action.payload);
      else state.locations[idx] = action.payload;
    },
    locationRemoved(state, action: PayloadAction<string>) {
      state.locations = state.locations.filter((l) => l.id !== action.payload);
    },
    settingsSet(state, action: PayloadAction<InventorySettings>) {
      state.settings = action.payload;
    },
    platformDefaultsMerged(state, action: PayloadAction<PlatformLocationDefault[]>) {
      for (const row of action.payload) {
        const idx = state.platformDefaults.findIndex((d) => d.platform === row.platform);
        if (idx === -1) state.platformDefaults.push(row);
        else state.platformDefaults[idx] = row;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdvancedInventory.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAdvancedInventory.fulfilled, (state, action) => {
        state.settings = action.payload.settings;
        state.locations = action.payload.locations;
        state.platformDefaults = action.payload.platformDefaults;
        state.loaded = true;
        state.loading = false;
        state.error = null;
      })
      .addCase(fetchAdvancedInventory.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || LOAD_ERROR;
      });
  },
});

export const { locationSaved, locationRemoved, settingsSet, platformDefaultsMerged } =
  advancedInventorySlice.actions;
```

- [ ] **Step 4: Register the slice** — in `src/store/store.ts` add the import after the `inventorySlice` import:

```ts
import { advancedInventorySlice } from "@/app/dashboard/inventory/_store/advancedInventorySlice";
```

and the reducer entry after `inventory: inventorySlice.reducer,`:

```ts
      advancedInventory: advancedInventorySlice.reducer,
```

- [ ] **Step 5: Run it — expect PASS**

Run: `npx jest src/app/dashboard/inventory/_store/advancedInventorySlice.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/inventory/_store/advancedInventorySlice.ts src/app/dashboard/inventory/_store/advancedInventorySlice.test.ts src/store/store.ts
git commit -m "feat(inventory): advancedInventory slice — settings, locations, platform defaults

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Page shell — tabs, products tab extraction, upsell, loading/error

**Files:**
- Create: `src/app/dashboard/inventory/_components/InventoryTabs.tsx`
- Create: `src/app/dashboard/inventory/_components/ProductsTab.tsx`
- Create: `src/app/dashboard/inventory/_components/AdvancedInventoryUpsellCard.tsx`
- Modify: `src/app/dashboard/inventory/page.tsx` (full rewrite below)

**Interfaces:**
- Consumes: `advancedInventoryView` (Task 1), `fetchAdvancedInventory` + `state.advancedInventory` (Task 2), `hasAdvancedInventory`.
- Produces: `InventoryTabs({ tabs, active, onChange })` with `type InventoryTabId = "products" | "locations"`; `ProductsTab({ addOpen, onAddClose })`; `AdvancedInventoryUpsellCard()`.
- Scope note: after this task the "enable" and "active" views both render the plain products page. The enable card arrives in Task 4 and the tab strip in Task 6 (it's only rendered once there's a Locations tab to switch to), so no half-built UI ever ships.

- [ ] **Step 1: `InventoryTabs.tsx`**:

```tsx
"use client";

export type InventoryTabId = "products" | "locations";

interface Props {
  tabs: { id: InventoryTabId; label: string }[];
  active: InventoryTabId;
  onChange: (id: InventoryTabId) => void;
}

export function InventoryTabs({ tabs, active, onChange }: Props) {
  return (
    <div role="tablist" aria-label="Inventory sections" className="mb-4 flex gap-1 border-b border-(--color-border)">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`inventory-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`inventory-panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
              (selected
                ? "border-(--color-primary) text-(--color-text-strong)"
                : "border-transparent text-(--color-text-muted) hover:text-(--color-text-base)")
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: `ProductsTab.tsx`** — move today's `page.tsx` body into it with no behaviour change. It is today's `InventoryPage` minus `PageHeader` and minus the `addOpen` state, which becomes props:

```tsx
"use client";

import { useState, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeProduct, fetchInventoryPage } from "../_store/inventorySlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { Pencil, Trash2 } from "lucide-react";
import { AddProductModal } from "./AddProductModal";
import { EditProductModal } from "./EditProductModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import type { Product } from "@/types";

function isLowStock(p: Product): boolean {
  return p.reorder_threshold != null && p.current_stock <= p.reorder_threshold;
}

interface Props {
  /** The page header owns the "+ Add Product" button; this tab owns the modal. */
  addOpen: boolean;
  onAddClose: () => void;
}

export function ProductsTab({ addOpen, onAddClose }: Props) {
  // …the body of today's InventoryPage, verbatim, from `const dispatch = …`
  // through the closing `</div>` of its returned JSX, with exactly these edits:
  //   1. delete `const [addOpen, setAddOpen] = useState(false);`
  //   2. delete the <PageHeader …/> element from the returned JSX
  //   3. <AddProductModal open={addOpen} onClose={onAddClose} … />
}
```

Implementation note for the executor: open the current `src/app/dashboard/inventory/page.tsx`, copy its component body into `ProductsTab` and apply only the three listed edits (it is today's code, not new code; the comment above stands in for ~190 unchanged lines). Also remove the now-unused `PageHeader` import. Nothing else changes — same columns, search, delete flow, toasts and empty message.

- [ ] **Step 3: `AdvancedInventoryUpsellCard.tsx`**:

```tsx
"use client";

import Link from "next/link";
import { Boxes } from "lucide-react";

export function AdvancedInventoryUpsellCard() {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4">
      <Boxes size={18} className="mt-0.5 shrink-0 text-(--color-text-muted)" aria-hidden />
      <div>
        <h2 className="text-base font-semibold text-(--color-text-strong)">Batches &amp; locations</h2>
        <p className="mt-1 text-sm text-(--color-text-muted)">
          Track each batch&apos;s landed cost, stock per warehouse (including Amazon FBA), and FIFO cost of goods
          on every order. Available on the Business plan.
        </p>
        <Link
          href="/dashboard/settings"
          className="mt-2 inline-block text-sm font-medium text-(--color-primary) hover:underline"
        >
          View plans &amp; billing →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `page.tsx`**:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { hasAdvancedInventory } from "@/lib/utils/planGating";
import { advancedInventoryView } from "./_lib/advancedInventory";
import { fetchAdvancedInventory } from "./_store/advancedInventorySlice";
import { ProductsTab } from "./_components/ProductsTab";
import { AdvancedInventoryUpsellCard } from "./_components/AdvancedInventoryUpsellCard";

export default function InventoryPage() {
  const dispatch = useAppDispatch();
  const plan = useAppSelector((s) => s.currentUser.tenantPlan);
  const advanced = useAppSelector((s) => s.advancedInventory);
  const [addProductOpen, setAddProductOpen] = useState(false);

  const entitled = !!plan && hasAdvancedInventory(plan);
  const view = advancedInventoryView(plan, advanced);

  useEffect(() => {
    if (entitled && !advanced.loaded && !advanced.loading && !advanced.error) {
      dispatch(fetchAdvancedInventory());
    }
  }, [entitled, advanced.loaded, advanced.loading, advanced.error, dispatch]);

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Products tracked through linked purchases and sales"
        action={<Button onClick={() => setAddProductOpen(true)}>+ Add Product</Button>}
      />

      {view === "upsell" && <AdvancedInventoryUpsellCard />}

      {view === "loading" && (
        <p className="mb-4 flex items-center gap-2 text-sm text-(--color-text-muted)">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Loading batches &amp; locations…
        </p>
      )}

      {view === "error" && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4">
          <p className="text-sm text-(--color-text-muted)">{advanced.error}</p>
          <Button variant="secondary" onClick={() => dispatch(fetchAdvancedInventory())}>
            <RefreshCw size={15} aria-hidden /> Retry
          </Button>
        </div>
      )}

      <ProductsTab addOpen={addProductOpen} onAddClose={() => setAddProductOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 5: Run the inventory tests** — `npx jest src/app/dashboard/inventory` — expect PASS (the slice and lib tests; no behaviour change to `inventorySlice`).

- [ ] **Step 6: Verify the page** — if the Playwright MCP is connected and `npm run dev` is already running, open `/dashboard/inventory` and confirm the products table, search, pagination and Add/Edit/Delete product still work, and the upsell card appears for a non-Business tenant. Otherwise record in your report that manual verification is pending and list what to click.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/inventory/page.tsx src/app/dashboard/inventory/_components/InventoryTabs.tsx src/app/dashboard/inventory/_components/ProductsTab.tsx src/app/dashboard/inventory/_components/AdvancedInventoryUpsellCard.tsx
git commit -m "feat(inventory): page shell for batches & locations — upsell, loading and error states

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Enable flow

**Files:**
- Create: `src/app/dashboard/inventory/_components/EnableAdvancedCard.tsx`
- Modify: `src/app/dashboard/inventory/page.tsx`

**Interfaces:**
- Consumes: `POST /api/inventory/enable-advanced` (Phase 1), `fetchAdvancedInventory` (Task 2), `writeAuditLog`, `addAuditLog`, `useToast`.
- Produces: `EnableAdvancedCard({ isAdmin: boolean })`.

- [ ] **Step 1: `EnableAdvancedCard.tsx`**:

```tsx
"use client";

import { useState } from "react";
import { Boxes, Loader2 } from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { fetchAdvancedInventory } from "../_store/advancedInventorySlice";

interface Props {
  isAdmin: boolean;
}

export function EnableAdvancedCard({ isAdmin }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);

  async function handleEnable() {
    setEnabling(true);
    try {
      const res = await fetch("/api/inventory/enable-advanced", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toastError("Could not enable batches & locations", body.error ?? "Please try again.");
        return;
      }
      const supabase = await createTenantClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const log = await writeAuditLog(supabase, {
          userId: user.id,
          userEmail: user.email ?? "",
          action: "update",
          entityType: "inventory_settings",
          metadata: { event: "advanced_inventory_enabled" },
        });
        if (log) dispatch(addAuditLog(log));
      }
      await dispatch(fetchAdvancedInventory());
      setConfirmOpen(false);
      success("Batches & locations enabled", "Your current stock is now an opening batch at “Main”.");
    } catch {
      toastError("Could not enable batches & locations", "Please check your connection and try again.");
    } finally {
      setEnabling(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4">
        <div className="flex items-start gap-3">
          <Boxes size={18} className="mt-0.5 shrink-0 text-(--color-text-muted)" aria-hidden />
          <div>
            <h2 className="text-base font-semibold text-(--color-text-strong)">Batches &amp; locations</h2>
            <p className="mt-1 text-sm text-(--color-text-muted)">
              Track each batch&apos;s landed cost, stock per warehouse, and FIFO cost of goods on every order.
              {!isAdmin && " Ask an admin to turn it on."}
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            Enable
          </Button>
        )}
      </div>

      <Modal
        title="Enable batches & locations?"
        open={confirmOpen}
        onClose={() => { if (!enabling) setConfirmOpen(false); }}
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => setConfirmOpen(false)} disabled={enabling}>
              Cancel
            </Button>
            <Button type="button" onClick={handleEnable} disabled={enabling}>
              {enabling ? <><Loader2 size={15} className="animate-spin" aria-hidden /> Enabling…</> : "Enable"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-(--color-text-base)">
          <p>This creates a “Main” location, sends every platform&apos;s orders from it by default, and turns
            each product&apos;s current stock into an opening batch at a cost of 0 (you can edit that cost later).</p>
          <p>From then on, purchases become batches and every order gets FIFO cost of goods.</p>
          <p className="font-medium text-(--color-text-strong)">This can&apos;t be turned off again.</p>
        </div>
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Wire it into `page.tsx`** — add imports:

```tsx
import { EnableAdvancedCard } from "./_components/EnableAdvancedCard";
```

add after the `plan` selector:

```tsx
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const isAdmin = role === "admin" || role === "super_admin";
```

and render, directly after the `view === "error"` block:

```tsx
      {view === "enable" && <EnableAdvancedCard isAdmin={isAdmin} />}
```

- [ ] **Step 3: Verify** — Playwright MCP + running dev server only (see Global Constraints); otherwise list in the report: as a Business/trial admin on a tenant with 048 applied, click Enable → confirm → toast, card disappears (the "active" view renders the plain products page until Task 6). As a non-admin, no Enable button.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/inventory/_components/EnableAdvancedCard.tsx src/app/dashboard/inventory/page.tsx
git commit -m "feat(inventory): enable batches & locations flow with one-way confirm

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Location add/edit modal

**Files:**
- Create: `src/app/dashboard/inventory/_components/LocationModal.tsx`

**Interfaces:**
- Consumes: `LOCATION_TYPES`, `LOCATION_TYPE_LABELS`, `isLocationNameTaken` (Task 1); `locationSaved` (Task 2); `inventoryErrorMessage`.
- Produces: `LocationModal({ open, location, locations, onClose })` — `location: StockLocation | null` (null = add). Render it with `key={location?.id ?? "new-location"}` so the form resets per target.

- [ ] **Step 1: `LocationModal.tsx`**:

```tsx
"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch } from "@/store/hooks";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { locationSaved } from "../_store/advancedInventorySlice";
import { LOCATION_TYPES, LOCATION_TYPE_LABELS, isLocationNameTaken } from "../_lib/advancedInventory";
import type { StockLocation, StockLocationType } from "@/types";

interface Props {
  open: boolean;
  /** null = add a new location. */
  location: StockLocation | null;
  locations: StockLocation[];
  onClose: () => void;
}

const FORM_ID = "location-form";

export function LocationModal({ open, location, locations, onClose }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const [name, setName] = useState(location?.name ?? "");
  const [type, setType] = useState<StockLocationType>(location?.type ?? "own");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameTaken = name.trim() !== "" && isLocationNameTaken(name, locations, location?.id);
  const isFormValid = name.trim() !== "" && !nameTaken;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid) return;
    setSaving(true);
    setError(null);

    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();
    const values = { name: name.trim(), type };

    const { data, error: dbError } = location
      ? await supabase.from("stock_locations").update(values).eq("id", location.id).select().single<StockLocation>()
      : await supabase
          .from("stock_locations")
          .insert({ ...values, created_by: user?.id ?? null })
          .select()
          .single<StockLocation>();

    if (dbError || !data) {
      const message =
        dbError?.code === "23505"
          ? "A location with this name already exists."
          : inventoryErrorMessage(dbError, "Could not save the location.");
      setError(message);
      toastError("Location not saved", message);
      setSaving(false);
      return;
    }

    dispatch(locationSaved(data));
    if (user) {
      const log = await writeAuditLog(supabase, {
        userId: user.id,
        userEmail: user.email ?? "",
        action: location ? "update" : "create",
        entityType: "stock_location",
        entityId: data.id,
        metadata: location ? { before: location, after: data } : { name: data.name, type: data.type },
      });
      if (log) dispatch(addAuditLog(log));
    }
    success(location ? "Location updated" : "Location added", `“${data.name}” was saved.`);
    setSaving(false);
    onClose();
  }

  return (
    <Modal
      title={location ? "Edit Location" : "Add Location"}
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={saving || !isFormValid}>
            {saving ? "Saving…" : location ? "Save Changes" : "Add Location"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-(--radius-btn) border border-red-200 bg-(--color-danger-bg) px-4 py-3 text-sm text-(--color-danger-text)">
            {error}
          </div>
        )}
        <Field label="Name" required error={nameTaken ? "A location with this name already exists." : undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amazon FBA DE" required />
        </Field>
        <Field label="Type" required>
          <Select value={type} onChange={(e) => setType(e.target.value as StockLocationType)} required>
            {LOCATION_TYPES.map((t) => (
              <option key={t} value={t}>{LOCATION_TYPE_LABELS[t]}</option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-(--color-text-muted)">
          Dropship suppliers never hold stock: orders fulfilled from them use the linked purchase as their cost.
        </p>
      </form>
    </Modal>
  );
}
```

Before writing, check `Field`'s props in `src/components/ui/FormFields.tsx` (`{ label, error, required, children }`) — `error` is a string shown under the control.

- [ ] **Step 2: Commit** (wired up and verified in Task 6)

```bash
git add src/app/dashboard/inventory/_components/LocationModal.tsx
git commit -m "feat(inventory): add/edit location modal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Locations tab + tabs in the active view

**Files:**
- Create: `src/app/dashboard/inventory/_components/LocationsTab.tsx`
- Modify: `src/app/dashboard/inventory/page.tsx`

**Interfaces:**
- Consumes: `sortLocations`, `LOCATION_TYPE_LABELS`, `locationDeactivationBlocker` (Task 1); `locationSaved`, `locationRemoved` (Task 2); `LocationModal` (Task 5); `InventoryTabs` (Task 3); `DeleteConfirmModal`.
- Produces: `LocationsTab({ isAdmin, addOpen, onAddClose })`. `FulfillmentDefaultsCard` is added to this tab in Task 7.

- [ ] **Step 1: `LocationsTab.tsx`**:

```tsx
"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { locationRemoved, locationSaved } from "../_store/advancedInventorySlice";
import { LOCATION_TYPE_LABELS, locationDeactivationBlocker, sortLocations } from "../_lib/advancedInventory";
import { LocationModal } from "./LocationModal";
import type { StockLocation } from "@/types";

interface Props {
  isAdmin: boolean;
  /** The page header owns the "+ Add Location" button; this tab owns the modal. */
  addOpen: boolean;
  onAddClose: () => void;
}

export function LocationsTab({ isAdmin, addOpen, onAddClose }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError, warning } = useToast();
  const locations = useAppSelector((s) => s.advancedInventory.locations);
  const settings = useAppSelector((s) => s.advancedInventory.settings);
  const [editTarget, setEditTarget] = useState<StockLocation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StockLocation | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function audit(action: "update" | "delete", location: StockLocation, metadata: Record<string, unknown>) {
    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const log = await writeAuditLog(supabase, {
      userId: user.id,
      userEmail: user.email ?? "",
      action,
      entityType: "stock_location",
      entityId: location.id,
      metadata,
    });
    if (log) dispatch(addAuditLog(log));
  }

  async function handleToggleActive(location: StockLocation) {
    const blocker = locationDeactivationBlocker(location, settings);
    if (blocker) {
      warning("Can't deactivate", blocker);
      return;
    }
    setTogglingId(location.id);
    const supabase = await createTenantClient();
    const { data, error } = await supabase
      .from("stock_locations")
      .update({ is_active: !location.is_active })
      .eq("id", location.id)
      .select()
      .single<StockLocation>();
    setTogglingId(null);
    if (error || !data) {
      toastError("Location not updated", inventoryErrorMessage(error, "Could not update the location."));
      return;
    }
    dispatch(locationSaved(data));
    await audit("update", data, { before: location, after: data });
    success(data.is_active ? "Location reactivated" : "Location deactivated", `“${data.name}”`);
  }

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const supabase = await createTenantClient();
    const { error } = await supabase.from("stock_locations").delete().eq("id", target.id);
    if (error) {
      toastError("Delete failed", inventoryErrorMessage(error, "Could not delete the location."));
      return;
    }
    dispatch(locationRemoved(target.id));
    await audit("delete", target, { before: target, reason });
    success("Location deleted", `“${target.name}” has been removed.`);
    setDeleteTarget(null);
  }

  const columns = [
    {
      header: "Location",
      sortValue: (l: StockLocation) => l.name.toLowerCase(),
      render: (l: StockLocation) => (
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-(--color-text-strong)">{l.name}</span>
          {settings?.default_location_id === l.id && <Badge label="Default" variant="info" />}
        </span>
      ),
    },
    {
      header: "Type",
      sortValue: (l: StockLocation) => LOCATION_TYPE_LABELS[l.type],
      render: (l: StockLocation) => <span className="text-sm text-(--color-text-base)">{LOCATION_TYPE_LABELS[l.type]}</span>,
    },
    {
      header: "Status",
      render: (l: StockLocation) =>
        l.is_active ? <Badge label="Active" variant="success" /> : <Badge label="Inactive" />,
    },
    ...(isAdmin
      ? [
          {
            header: "Actions",
            render: (l: StockLocation) => (
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEditTarget(l)} title="Edit" aria-label={`Edit ${l.name}`}>
                  <Pencil size={15} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleToggleActive(l)}
                  disabled={togglingId === l.id}
                  title={l.is_active ? "Deactivate" : "Reactivate"}
                  aria-label={`${l.is_active ? "Deactivate" : "Reactivate"} ${l.name}`}
                >
                  {l.is_active ? <Archive size={15} /> : <ArchiveRestore size={15} />}
                </Button>
                <Button
                  size="icon"
                  variant="danger"
                  onClick={() => setDeleteTarget(l)}
                  title="Delete"
                  aria-label={`Delete ${l.name}`}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div id="inventory-panel-locations" role="tabpanel" aria-labelledby="inventory-tab-locations" className="space-y-6">
      {!isAdmin && (
        <p className="text-sm text-(--color-text-muted)">Only admins can add or change locations.</p>
      )}
      <DataTable
        columns={columns}
        rows={sortLocations(locations)}
        keyField="id"
        emptyMessage="No locations yet — add your own warehouse, Amazon FBA or a 3PL."
      />

      <LocationModal
        key={editTarget?.id ?? (addOpen ? "new-location" : "closed")}
        open={addOpen || !!editTarget}
        location={editTarget}
        locations={locations}
        onClose={() => { setEditTarget(null); onAddClose(); }}
      />
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Location"
        description={`Delete “${deleteTarget?.name}”? A location that has ever held stock or fulfilled an order can't be deleted — deactivate it instead.`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
```

Before writing, confirm `DataTable`'s column shape and whether `sortValue` is optional (read `src/components/ui/DataTable.tsx`), `Button`'s `size`/`variant`/`disabled` props, and `DeleteConfirmModal`'s props (`open`, `title`, `description`, `onConfirm(reason)`, `onClose`, optional `confirmingLabel`) — match them exactly.

- [ ] **Step 2: Tabs in `page.tsx`** — add imports:

```tsx
import { InventoryTabs, type InventoryTabId } from "./_components/InventoryTabs";
import { LocationsTab } from "./_components/LocationsTab";
```

add state:

```tsx
  const [tab, setTab] = useState<InventoryTabId>("products");
  const [addLocationOpen, setAddLocationOpen] = useState(false);
  const showLocations = view === "active" && tab === "locations";
```

change the `PageHeader` action to:

```tsx
        action={
          showLocations ? (
            isAdmin ? <Button onClick={() => setAddLocationOpen(true)}>+ Add Location</Button> : undefined
          ) : (
            <Button onClick={() => setAddProductOpen(true)}>+ Add Product</Button>
          )
        }
```

and replace `<ProductsTab … />` with:

```tsx
      {view === "active" && (
        <InventoryTabs
          tabs={[
            { id: "products", label: "Products" },
            { id: "locations", label: "Locations" },
          ]}
          active={tab}
          onChange={setTab}
        />
      )}

      {showLocations ? (
        <LocationsTab isAdmin={isAdmin} addOpen={addLocationOpen} onAddClose={() => setAddLocationOpen(false)} />
      ) : (
        <div id="inventory-panel-products" role={view === "active" ? "tabpanel" : undefined} aria-labelledby={view === "active" ? "inventory-tab-products" : undefined}>
          <ProductsTab addOpen={addProductOpen} onAddClose={() => setAddProductOpen(false)} />
        </div>
      )}
```

- [ ] **Step 3: Run tests** — `npx jest src/app/dashboard/inventory` — expect PASS.

- [ ] **Step 4: Verify** — Playwright MCP + running dev server only; otherwise list for the user: tabs switch; add a location; duplicate name disables Add; edit; deactivate the default → warning toast; deactivate another → Inactive badge; delete an unused location; delete Main → "This location is in use…" toast; non-admin sees no actions and no Add button.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/inventory/_components/LocationsTab.tsx src/app/dashboard/inventory/page.tsx
git commit -m "feat(inventory): Locations tab — list, add, edit, deactivate, delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Fulfillment defaults card

**Files:**
- Create: `src/app/dashboard/inventory/_components/FulfillmentDefaultsCard.tsx`
- Modify: `src/app/dashboard/inventory/_components/LocationsTab.tsx`

**Interfaces:**
- Consumes: `fulfillmentDraftFrom`, `platformDefaultChanges`, `isFulfillmentDraftValid`, `isFulfillmentDraftDirty`, `defaultLocationOptions`, `platformLocationOptions`, `INVENTORY_PLATFORMS`, `PLATFORM_LABELS`, `LOCATION_TYPE_LABELS` (Task 1); `settingsSet`, `platformDefaultsMerged` (Task 2); RPC `set_default_location(p_location_id uuid)` (Phase 1).
- Produces: `FulfillmentDefaultsCard({ isAdmin })`.

- [ ] **Step 1: `FulfillmentDefaultsCard.tsx`**:

```tsx
"use client";

import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { Button } from "@/components/ui/Button";
import { Field, Row, Select } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { platformDefaultsMerged, settingsSet } from "../_store/advancedInventorySlice";
import {
  INVENTORY_PLATFORMS,
  LOCATION_TYPE_LABELS,
  PLATFORM_LABELS,
  defaultLocationOptions,
  fulfillmentDraftFrom,
  isFulfillmentDraftDirty,
  isFulfillmentDraftValid,
  platformDefaultChanges,
  platformLocationOptions,
  type FulfillmentDraft,
} from "../_lib/advancedInventory";
import type { Platform } from "@/types";

const FORM_ID = "fulfillment-defaults-form";

interface Props {
  isAdmin: boolean;
}

export function FulfillmentDefaultsCard({ isAdmin }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const settings = useAppSelector((s) => s.advancedInventory.settings);
  const locations = useAppSelector((s) => s.advancedInventory.locations);
  const platformDefaults = useAppSelector((s) => s.advancedInventory.platformDefaults);

  const [draft, setDraft] = useState<FulfillmentDraft>(() => fulfillmentDraftFrom(settings, platformDefaults));
  const [saving, setSaving] = useState(false);

  const isFormValid = isFulfillmentDraftValid(draft, locations);
  const isDirty = isFulfillmentDraftDirty(settings, platformDefaults, draft);

  function setPlatform(platform: Platform, locationId: string) {
    setDraft((d) => ({ ...d, platforms: { ...d.platforms, [platform]: locationId } }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!settings || !isFormValid || !isDirty) return;
    setSaving(true);
    const supabase = await createTenantClient();
    const before = { defaultLocationId: settings.default_location_id, platformDefaults };

    if (draft.defaultLocationId !== settings.default_location_id) {
      const { error } = await supabase.rpc("set_default_location", { p_location_id: draft.defaultLocationId });
      if (error) {
        toastError("Defaults not saved", inventoryErrorMessage(error, "Could not change the default location."));
        setSaving(false);
        return;
      }
      dispatch(settingsSet({ ...settings, default_location_id: draft.defaultLocationId }));
    }

    const changes = platformDefaultChanges(platformDefaults, draft);
    if (changes.length > 0) {
      const { error } = await supabase.from("platform_location_defaults").upsert(changes, { onConflict: "platform" });
      if (error) {
        toastError("Defaults not saved", inventoryErrorMessage(error, "Could not save the platform defaults."));
        setSaving(false);
        return;
      }
      dispatch(platformDefaultsMerged(changes));
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const log = await writeAuditLog(supabase, {
        userId: user.id,
        userEmail: user.email ?? "",
        action: "update",
        entityType: "inventory_settings",
        metadata: { event: "fulfillment_defaults_changed", before, after: draft },
      });
      if (log) dispatch(addAuditLog(log));
    }
    success("Fulfillment defaults saved", "New orders will use these locations.");
    setSaving(false);
  }

  const optionLabel = (id: string) => {
    const l = locations.find((x) => x.id === id);
    return l ? `${l.name} · ${LOCATION_TYPE_LABELS[l.type]}${l.is_active ? "" : " (inactive)"}` : "";
  };

  return (
    <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6">
      <h2 className="text-base font-semibold text-(--color-text-strong)">Fulfillment defaults</h2>
      <p className="mt-1 text-sm text-(--color-text-muted)">
        Where new orders ship from when no location is chosen — including orders synced from eBay and Amazon.
        You can still change the location on any order.
      </p>

      <form id={FORM_ID} onSubmit={handleSubmit} className="mt-4 space-y-4">
        <Field label="Default location" required>
          <Select
            value={draft.defaultLocationId}
            onChange={(e) => setDraft((d) => ({ ...d, defaultLocationId: e.target.value }))}
            disabled={!isAdmin || saving}
            required
          >
            <option value="" disabled>Choose a location</option>
            {defaultLocationOptions(locations).map((l) => (
              <option key={l.id} value={l.id}>{optionLabel(l.id)}</option>
            ))}
          </Select>
        </Field>

        <Row>
          {INVENTORY_PLATFORMS.map((platform) => (
            <Field key={platform} label={PLATFORM_LABELS[platform]} required>
              <Select
                value={draft.platforms[platform]}
                onChange={(e) => setPlatform(platform, e.target.value)}
                disabled={!isAdmin || saving}
                required
              >
                <option value="" disabled>Choose a location</option>
                {platformLocationOptions(locations, draft.platforms[platform] || null).map((l) => (
                  <option key={l.id} value={l.id}>{optionLabel(l.id)}</option>
                ))}
              </Select>
            </Field>
          ))}
        </Row>

        {isAdmin && (
          <div className="flex justify-end">
            <Button type="submit" form={FORM_ID} variant="secondary" disabled={saving || !isFormValid || !isDirty}>
              {saving ? "Saving…" : "Save defaults"}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}
```

Before writing, check `Row` in `src/components/ui/FormFields.tsx`: if it lays out exactly two columns, wrap the five platform fields in `<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">` instead of `<Row>` (copy the gap/breakpoint classes `Row` uses).

- [ ] **Step 2: Mount it in `LocationsTab.tsx`** — render it after the `<DataTable … />`, remounted whenever the stored defaults or locations change so its draft resets to the saved values. Add the import:

```tsx
import { FulfillmentDefaultsCard } from "./FulfillmentDefaultsCard";
```

add a selector next to the others at the top of `LocationsTab`:

```tsx
  const platformDefaults = useAppSelector((s) => s.advancedInventory.platformDefaults);
```

build the key below the selectors:

```tsx
  const defaultsKey = [
    settings?.default_location_id ?? "",
    locations.map((l) => `${l.id}:${l.is_active ? 1 : 0}`).join(","),
    [...platformDefaults].sort((a, b) => a.platform.localeCompare(b.platform)).map((d) => `${d.platform}=${d.location_id}`).join(","),
  ].join("|");
```

```tsx
      <FulfillmentDefaultsCard key={defaultsKey} isAdmin={isAdmin} />
```

- [ ] **Step 3: Run tests** — `npx jest src/app/dashboard/inventory` — expect PASS.

- [ ] **Step 4: Verify** — Playwright MCP + running dev server only; otherwise list for the user: Save stays disabled until something changes; dropship isn't offered as the default location; map Amazon → FBA and save → toast; reload → values persist; non-admin sees disabled selects and no Save.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/inventory/_components/FulfillmentDefaultsCard.tsx src/app/dashboard/inventory/_components/LocationsTab.tsx
git commit -m "feat(inventory): fulfillment defaults — default location and per-platform locations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs

**Files:**
- Modify: `src/app/dashboard/inventory/CLAUDE.md`, `src/app/dashboard/inventory/SKILL.md`
- Modify: `docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md`

- [ ] **Step 1: `inventory/CLAUDE.md`** — in "Files in this folder" add:

```markdown
- `_lib/advancedInventory.ts` (+ test) — pure logic for the batches &
  locations UI: `advancedInventoryView` (upsell/loading/error/enable/active),
  location sorting and option filters, name-uniqueness check, deactivation
  blocker, fulfillment-defaults draft/diff/validation, labels.
- `_store/advancedInventorySlice.ts` (+ test) — `state.advancedInventory`:
  settings, locations, platform defaults; `fetchAdvancedInventory` thunk,
  dispatched by `page.tsx` only when the plan allows (not by `layout.tsx`).
- `_components/ProductsTab.tsx` — the products table/search/pagination and
  product modals (moved out of `page.tsx` unchanged).
- `_components/InventoryTabs.tsx` — accessible Products/Locations tab strip.
- `_components/AdvancedInventoryUpsellCard.tsx`, `EnableAdvancedCard.tsx` —
  Starter/Pro upsell; Business/trial one-way enable flow
  (`POST /api/inventory/enable-advanced`).
- `_components/LocationsTab.tsx`, `LocationModal.tsx`,
  `FulfillmentDefaultsCard.tsx` — location CRUD/deactivation and the default
  + per-platform fulfillment locations (`set_default_location` RPC,
  `platform_location_defaults` upsert).
```

and replace the Phase-1 section's last line ("UI arrives in Phases 2–4 …") with: "Phase 2 (this UI) shows the enable flow and the Locations tab; batches on purchases/sales (Phase 3) and transfers (Phase 4) come next."

- [ ] **Step 2: `inventory/SKILL.md`** — add a minimal-file-set bullet:

```markdown
- **Change the batches & locations UI** (views, locations, fulfillment
  defaults): `_lib/advancedInventory.ts` (+ test) for any decision or
  validation, `_store/advancedInventorySlice.ts` (+ test) for state, then the
  component in `_components/`. `page.tsx` only composes views and tabs.
```

and gotchas:

```markdown
- **Advanced inventory state is page-loaded, not layout-hydrated.**
  `page.tsx` dispatches `fetchAdvancedInventory()` only when
  `hasAdvancedInventory(plan)`; other pages never read `state.advancedInventory`.
  Phase 3's Purchases/Sales modals will need it too — dispatch the same thunk
  from them rather than moving it into `layout.tsx`.
- **An existing tenant shows the load-error card until `048` is applied.**
  Before `048_advanced_inventory_apply.sql` runs, Business/trial tenants
  created before Phase 1 have no `inventory_settings` table, so the fetch
  fails and the page shows the Retry card — by design.
- **`FulfillmentDefaultsCard` is keyed on the stored defaults** so its draft
  resets after a save or a location change; don't hold that draft in Redux.
- **Location type changes can be refused by the database**
  (`INV_LOCATION_IN_USE` when switching to/from dropship with stock history) —
  `LocationModal` shows the trigger's message via `inventoryErrorMessage`.
```

- [ ] **Step 3: Spec** — under "Phasing", after item 2, add: "Phase 2 status: implemented per `docs/superpowers/plans/2026-09-26-advanced-inventory-phase-2-locations-ui.md`. The Locations table's per-location on-hand units column moves to Phase 3, together with the per-location stock RPC."

- [ ] **Step 4: Run the feature's tests** — `npx jest src/app/dashboard/inventory src/lib/inventory` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/inventory/CLAUDE.md src/app/dashboard/inventory/SKILL.md docs/superpowers/specs/2026-09-25-advanced-inventory-batches-locations-design.md
git commit -m "docs(inventory): batches & locations UI — file map, playbook, gotchas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (Phase 2)

| Spec requirement | Task |
| --- | --- |
| UI shows advanced features iff plan allows AND flag on | 1 (`advancedInventoryView`), 3 |
| Starter/Pro: today's page + upsell card | 3 |
| Business with flag off: enable card, admins only, one-way explanation | 4 |
| Enable route + audit | 4 |
| Tabs: Products · Locations (Transfers in Phase 4) | 3, 6 |
| Locations CRUD, type, deactivate, delete blocked when in use | 5, 6 |
| Default fulfillment location per platform (+ tenant default) | 7 |
| Errors via `INV_*` copy, never raw Postgres | 5, 6, 7 |
| Audit for locations, enable, defaults | 4, 5, 6, 7 |
| Per-location on-hand units column | **Moved to Phase 3** (needs the per-location stock RPC) |
