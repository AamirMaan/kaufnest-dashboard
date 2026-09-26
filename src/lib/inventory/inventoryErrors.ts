/**
 * Advanced-inventory triggers and RPCs (supabase/migrations/047) raise
 * `'<INV_CODE>: <detail>'`. The detail text is authored in that migration
 * and is user-safe by contract, so it is shown as-is; anything that does
 * not parse as a known code is a raw database error and is replaced by a
 * generic message — raw Postgres errors never reach the UI.
 *
 * Pure: safe to import from Client Components and route handlers alike.
 */
export const INVENTORY_ERROR_CODES = [
  "INV_CONSUMED",
  "INV_INSUFFICIENT",
  "INV_DROPSHIP_LOCATION",
  "INV_TRANSFER_IMMUTABLE",
  "INV_LOCATION_IN_USE",
  "INV_DEFAULT_LOCATION",
  "INV_NOT_ENABLED",
  "INV_FORBIDDEN",
  "INV_NOT_OPENING",
  "INV_INVALID_COST",
] as const;

export type InventoryErrorCode = (typeof INVENTORY_ERROR_CODES)[number];

export const INVENTORY_ERROR_FALLBACK = "Something went wrong while updating inventory. Please try again.";

const PATTERN = /^(INV_[A-Z_]+):\s*([\s\S]+)$/;

export function parseInventoryError(message: unknown): { code: InventoryErrorCode; detail: string } | null {
  if (typeof message !== "string") return null;
  const match = PATTERN.exec(message.trim());
  if (!match) return null;
  const code = match[1];
  if (!(INVENTORY_ERROR_CODES as readonly string[]).includes(code)) return null;
  return { code: code as InventoryErrorCode, detail: match[2].trim() };
}

export function inventoryErrorMessage(err: unknown, fallback: string = INVENTORY_ERROR_FALLBACK): string {
  const message =
    typeof err === "string"
      ? err
      : err !== null && typeof err === "object" && "message" in err
        ? (err as { message: unknown }).message
        : null;
  return parseInventoryError(message)?.detail ?? fallback;
}
