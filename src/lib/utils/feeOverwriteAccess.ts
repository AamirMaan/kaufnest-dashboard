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
