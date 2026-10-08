import type { PlatformConnection } from "@/types";

export function platformHeading(label: string, count: number, cap: number): string {
  if (Number.isFinite(cap)) return `${label} — ${count} of ${cap} accounts`;
  return `${label} — ${count} account${count === 1 ? "" : "s"}`;
}

/** Pre-056 eBay connections have no account id until reconnected once. */
export function needsReconnectBanner(connections: PlatformConnection[]): boolean {
  return connections.some((c) => c.platform === "ebay" && c.status === "connected" && c.external_account_id === null);
}
