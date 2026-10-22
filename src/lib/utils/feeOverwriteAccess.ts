import type { UserRole } from "@/types";

/**
 * Who may replace stored order fees with eBay's (the overwrite path, unlike
 * fill-only "Sync eBay charges"). Pure and client-safe: ConnectionCard shows the
 * button with it and requireIntegrationSuperAdmin enforces it server-side.
 */
export function canOverwriteEbayFees(role: UserRole | null | undefined): boolean {
  return role === "super_admin";
}

/**
 * Max fee changes per apply request (server: parseFeeOverwriteApply; client:
 * FeeOverwriteModal batches by it). Shared here so the two can't drift.
 */
export const FEE_OVERWRITE_MAX_CHANGES = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Default preview window: the same 90 days as Review Orders / charge sync. */
export const FEE_OVERWRITE_DEFAULT_DAYS = 90;
/** eBay Finances rejects a transactionDate range longer than 36 months (error 135014). */
export const FEE_OVERWRITE_MAX_MONTHS = 36;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The preview's "From" date picker range, as UTC YYYY-MM-DD: earliest is a day
 * inside eBay's 36-month limit (the range runs to now, not midnight), latest is today.
 */
export function overwriteFromBounds(now: Date): { min: string; max: string; fallback: string } {
  const min = new Date(now);
  min.setUTCMonth(min.getUTCMonth() - FEE_OVERWRITE_MAX_MONTHS);
  return {
    min: isoDay(new Date(min.getTime() + DAY_MS)),
    max: isoDay(now),
    fallback: isoDay(new Date(now.getTime() - FEE_OVERWRITE_DEFAULT_DAYS * DAY_MS)),
  };
}

/**
 * The preview request's optional `from` (YYYY-MM-DD) → the Finances window start.
 * Absent/blank keeps the 90-day default; anything else must be a real date within
 * overwriteFromBounds.
 */
export function parseOverwriteFrom(
  value: unknown,
  now: Date
): { ok: true; from: string } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, from: new Date(now.getTime() - FEE_OVERWRITE_DEFAULT_DAYS * DAY_MS).toISOString() };
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, error: "from must be a date (YYYY-MM-DD)" };
  }
  const start = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || isoDay(start) !== value) {
    return { ok: false, error: "from must be a date (YYYY-MM-DD)" };
  }
  const { min, max } = overwriteFromBounds(now);
  if (value < min || value > max) {
    return { ok: false, error: `from must be between ${min} and ${max}` };
  }
  return { ok: true, from: start.toISOString() };
}
