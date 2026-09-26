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
 * keeps running in the database, only the UI is hidden. A failed background
 * refresh (`load.error` set but `load.loaded` already true — e.g. a `force`
 * reload after the first successful load) keeps showing the last loaded
 * view instead of bouncing to the error card; only a failure on the very
 * first load (never `loaded`) shows the error card.
 */
export function advancedInventoryView(
  plan: TenantPlan | null,
  load: AdvancedInventoryLoadState,
): AdvancedInventoryView {
  if (!plan || !hasAdvancedInventory(plan)) return "upsell";
  if (load.error && !load.loaded) return "error";
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
 * The tenant-default check mirrors the DB trigger. The platform-default
 * check below it has no blocking DB guard: since 049 the sale trigger skips
 * an inactive platform default and falls back to the tenant default, so
 * deactivating one wouldn't break orders — but it would silently reroute
 * that platform's orders, so the UI still asks the user to repoint the
 * platform first. Reactivation (`!location.is_active`) is never blocked.
 */
export function locationDeactivationBlocker(
  location: StockLocation,
  settings: InventorySettings | null,
  platformDefaults: PlatformLocationDefault[],
): string | null {
  if (location.is_active && settings?.default_location_id === location.id) {
    return "This is the default location. Choose another default location first.";
  }
  if (location.is_active) {
    const platforms = INVENTORY_PLATFORMS.filter((p) =>
      platformDefaults.some((d) => d.platform === p && d.location_id === location.id),
    );
    if (platforms.length > 0) {
      const labels = platforms.map((p) => PLATFORM_LABELS[p]).join(", ");
      const subject = platforms.length === 1 ? "that platform" : "those platforms";
      return `This location is the default for ${labels}. Choose another location for ${subject} first.`;
    }
  }
  return null;
}

/**
 * Whether the ledger triggers act on an UPDATE of a purchase/sale row created
 * at `createdAt`. Mirrors 047's `OLD.created_at < enabled_at` skip: rows that
 * predate enabling advanced inventory are never re-costed or re-located, so
 * their Edit modals must not offer location / landed-cost / fulfillment
 * fields. Compared as instants (Date.parse), so Postgres' `+00:00`/microsecond
 * form and JS' `Z`/millisecond form of the same moment compare equal. Fails
 * closed on a missing or unparseable timestamp.
 */
export function isTrackedByLedger(createdAt: string, settings: InventorySettings | null): boolean {
  if (!settings?.advanced_enabled || !settings.enabled_at) return false;
  const created = Date.parse(createdAt);
  const enabled = Date.parse(settings.enabled_at);
  if (Number.isNaN(created) || Number.isNaN(enabled)) return false;
  return created >= enabled;
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
