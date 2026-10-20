/**
 * Preset order statuses offered in the "Status" dropdown. Any other string
 * (entered via the "Other" option) is also valid — `status` is a free-form
 * text column, these are just the common values worth a one-click pick.
 */
export const ORDER_STATUSES = [
  "pending",
  "processing",
  "shipped",
  "delivered",
  "returned",
  "cancelled",
  "refunded",
] as const;

export type PresetOrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Status FILTER sentinel (not a storable status): pending OR processing —
 * the orders a dispatcher still has to ship. Applied by DispatchBanner's
 * link; get_sales_summary (057) matches the same literal.
 */
export const OPEN_ORDERS_STATUS = "__open__";
export const OPEN_ORDER_STATUSES = ["pending", "processing"] as const;

/** True if `status` is one of the preset dropdown values. */
export function isPresetStatus(status: string): status is PresetOrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(status);
}

/** Display label for a status — capitalizes custom ("Other") values too. */
export function statusLabel(status: string): string {
  if (!status) return status;
  if (status === OPEN_ORDERS_STATUS) return "Open (pending + processing)";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
