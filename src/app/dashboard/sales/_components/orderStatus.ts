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
] as const;

export type PresetOrderStatus = (typeof ORDER_STATUSES)[number];

/** True if `status` is one of the preset dropdown values. */
export function isPresetStatus(status: string): status is PresetOrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(status);
}

/** Display label for a status — capitalizes custom ("Other") values too. */
export function statusLabel(status: string): string {
  if (!status) return status;
  return status.charAt(0).toUpperCase() + status.slice(1);
}
