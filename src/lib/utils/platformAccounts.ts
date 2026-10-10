import type { PlatformAccount } from "@/types";
import { byCreatedAt } from "./activeAccounts";

/** "No account" filter value — keep in sync with '__unassigned__' in 056's get_sales_summary. */
export const UNASSIGNED_ACCOUNT = "__unassigned__";

export function accountLabel(a: Pick<PlatformAccount, "display_name" | "platform">): string {
  return a.display_name ?? (a.platform === "ebay" ? "eBay account" : "Amazon account");
}

/** Account UI (filters, columns, pickers) only appears once a platform has 2+ accounts. */
export function hasMultipleAccounts(accounts: Pick<PlatformAccount, "platform">[]): boolean {
  const counts = new Map<string, number>();
  for (const a of accounts) counts.set(a.platform, (counts.get(a.platform) ?? 0) + 1);
  return [...counts.values()].some((n) => n >= 2);
}

/** One platform's accounts, oldest first. */
export function accountOptionsFor(accounts: PlatformAccount[], platform: string): PlatformAccount[] {
  return accounts.filter((a) => a.platform === platform).sort(byCreatedAt);
}

/** Label for a sale's connection_id; null when unset or the account is gone. */
export function accountName(accounts: PlatformAccount[], id: string | null | undefined): string | null {
  if (!id) return null;
  const a = accounts.find((x) => x.id === id);
  return a ? accountLabel(a) : null;
}

/** CSV import "Assign all rows to account": applies only to rows on the account's own platform. */
export function accountForImportRow(rowPlatform: string, account: PlatformAccount | null): string | null {
  return account && account.platform === rowPlatform ? account.id : null;
}
