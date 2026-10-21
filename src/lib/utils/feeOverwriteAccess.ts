import type { UserRole } from "@/types";

/**
 * Who may replace stored order fees with eBay's (the overwrite path, unlike
 * fill-only "Sync eBay charges"). Pure and client-safe: ConnectionCard shows the
 * button with it and requireIntegrationSuperAdmin enforces it server-side.
 */
export function canOverwriteEbayFees(role: UserRole | null | undefined): boolean {
  return role === "super_admin";
}
