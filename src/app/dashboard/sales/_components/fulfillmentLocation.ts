import type { InventorySettings, Platform, PlatformLocationDefault, StockLocation } from "@/types";

/**
 * The location a new order ships from unless the user picks another one.
 * Mirrors inv_sale_before_write (047): the platform default if that location
 * is active, else the tenant default.
 */
export function suggestedFulfillmentLocationId(
  platform: Platform,
  platformDefaults: PlatformLocationDefault[],
  locations: StockLocation[],
  settings: InventorySettings | null,
): string {
  const platformDefault = platformDefaults.find((d) => d.platform === platform)?.location_id;
  if (platformDefault && locations.some((l) => l.id === platformDefault && l.is_active)) return platformDefault;
  return settings?.default_location_id ?? "";
}

export type StockWarning = { kind: "short"; available: number } | { kind: "dropship" } | null;

/**
 * `ownConsumption` is the number of units this very order already took from
 * `location` (Edit: the saved order's quantity when it consumed stock there).
 * `available` is read after that consumption, so those units are added back
 * before comparing with the order's full quantity.
 */
export function fulfillmentStockWarning(
  location: StockLocation | undefined,
  available: number | null,
  quantity: number,
  ownConsumption = 0,
): StockWarning {
  if (!location) return null;
  if (location.type === "dropship") return { kind: "dropship" };
  if (available === null) return null;
  const usable = available + ownConsumption;
  if (usable >= quantity) return null;
  return { kind: "short", available: Math.max(usable, 0) };
}

export function fulfillmentWarningText(warning: Exclude<StockWarning, null>, locationName: string): string {
  if (warning.kind === "dropship") {
    return `${locationName} is a dropship supplier: no stock is taken, so link a purchase to record the cost of goods.`;
  }
  return `Only ${warning.available} in stock at ${locationName}. The order will still be saved; the missing units are costed at the last known price until stock arrives.`;
}

/**
 * Options for the Orders page's Location filter: active, non-dropship
 * locations (where a dispatcher ships from), plus the currently selected one
 * even if it is inactive/dropship/unknown — so a URL-applied filter is always
 * shown and can be cleared. `selected` is "all" when no filter is applied.
 */
export function locationFilterOptions(
  locations: StockLocation[],
  selected: string,
): { id: string; name: string }[] {
  const options = locations
    .filter((l) => (l.is_active && l.type !== "dropship") || l.id === selected)
    .map((l) => ({ id: l.id, name: l.is_active ? l.name : `${l.name} (inactive)` }));
  if (selected !== "all" && !options.some((o) => o.id === selected)) {
    options.push({ id: selected, name: "Unknown location" });
  }
  return options;
}
