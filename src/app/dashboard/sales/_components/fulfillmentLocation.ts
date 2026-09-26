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

export function fulfillmentStockWarning(
  location: StockLocation | undefined,
  available: number | null,
  quantity: number,
): StockWarning {
  if (!location) return null;
  if (location.type === "dropship") return { kind: "dropship" };
  if (available === null || available >= quantity) return null;
  return { kind: "short", available: Math.max(available, 0) };
}

export function fulfillmentWarningText(warning: Exclude<StockWarning, null>, locationName: string): string {
  if (warning.kind === "dropship") {
    return `${locationName} is a dropship supplier: no stock is taken, so link a purchase to record the cost of goods.`;
  }
  return `Only ${warning.available} in stock at ${locationName}. The order will still be saved; the missing units are costed at the last known price until stock arrives.`;
}
