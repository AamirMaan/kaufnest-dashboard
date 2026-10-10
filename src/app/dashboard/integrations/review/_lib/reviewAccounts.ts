import type { ReviewOrder } from "@/app/api/integrations/review/route";

/** Distinct accounts present in a tab's orders, in first-seen order. */
export function accountsInOrders(orders: ReviewOrder[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const o of orders) if (!seen.has(o.connection_id)) seen.set(o.connection_id, o.account_name);
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** `"all"` keeps every order; otherwise only the given connection's. */
export function filterByAccount(orders: ReviewOrder[], accountId: string): ReviewOrder[] {
  return accountId === "all" ? orders : orders.filter((o) => o.connection_id === accountId);
}
