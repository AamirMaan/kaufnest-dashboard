import type { PlatformConnection } from "@/types";

/** A platform_connections row selected without 056's columns. */
export type PlatformConnectionPre056 = Omit<PlatformConnection, "external_username" | "display_name" | "is_active">;

/**
 * Fills 056's columns for a row read before 056 is applied (dashboard
 * layout's fallback select): no username or name yet, and not paused — the
 * same values 056's ADD COLUMN gives existing rows.
 */
export function withPre056Defaults(row: PlatformConnectionPre056): PlatformConnection {
  return { ...row, external_username: null, display_name: null, is_active: true };
}
