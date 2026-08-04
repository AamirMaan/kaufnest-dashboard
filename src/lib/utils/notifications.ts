import type { Notification, NotificationType } from "@/types";

export interface UnreadContext {
  /** Bulk "mark all read" watermark from `profiles.notifications_read_through`. */
  readThrough: string | null;
  /** Ids individually dismissed after the watermark. */
  readIds: Set<string>;
  /** Current user's id — you are never notified about your own action. */
  currentUserId: string;
}

/**
 * A notification is unread when all of these hold:
 *   1. it was not caused by the current user
 *   2. it was created strictly after the bulk watermark
 *   3. it has not been individually dismissed
 *
 * `actor_id` is null for externally-caused events (an inbound buyer message),
 * which are always unread — nobody in the tenant caused them.
 */
export function isUnread(n: Notification, ctx: UnreadContext): boolean {
  if (n.actor_id !== null && n.actor_id === ctx.currentUserId) return false;
  if (ctx.readIds.has(n.id)) return false;
  if (ctx.readThrough !== null && n.created_at <= ctx.readThrough) return false;
  return true;
}

export function unreadCount(items: Notification[], ctx: UnreadContext): number {
  return items.reduce((total, n) => (isUnread(n, ctx) ? total + 1 : total), 0);
}

/** Grouping label shown in the bell dropdown. */
export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  "sale.created": "Orders",
  "purchase.created": "Purchases",
  "product.low_stock": "Inventory",
  "message.received": "Messages",
};

/** Prefix marking a synthesized (non-database) notification id. */
export const LOW_STOCK_ID_PREFIX = "low-stock:";

export interface LowStockProduct {
  id: string;
  name: string;
  sku: string | null;
  current_stock: number;
  reorder_threshold: number;
}

/**
 * Low stock is a STATE, not an event — it flips back and forth as stock moves,
 * so it is evaluated on read rather than stored as notification rows. (A stored
 * crossing trigger double-fires on sale edits, because the stock trigger
 * reverts-then-reapplies and transiently crosses the threshold upward.)
 *
 * These objects are Notification-shaped so they reuse the bell's display code,
 * but they are NOT database rows: never insert their ids into
 * `notification_reads`, whose FK to `notifications.id` would reject them.
 */
export function synthesizeLowStock(products: LowStockProduct[]): Notification[] {
  const now = new Date().toISOString();
  return products
    // PostgREST cannot compare two columns in a filter, so the slice fetches
    // every product with a threshold set and the threshold test happens here.
    .filter((p) => p.reorder_threshold !== null && p.current_stock <= p.reorder_threshold)
    .map((p) => ({
    id: `${LOW_STOCK_ID_PREFIX}${p.id}`,
    type: "product.low_stock" as const,
    category: "inventory" as const,
    entity_type: "product",
    entity_id: p.id,
    title: `Low stock: ${p.name}`,
    body: `${p.current_stock} left (threshold ${p.reorder_threshold})`,
    link: "/dashboard/inventory",
    payload: {
      sku: p.sku,
      current_stock: p.current_stock,
      reorder_threshold: p.reorder_threshold,
    },
    actor_id: null,
    visible_to_roles: ["super_admin", "admin", "accountant"],
    required_permission: null,
    created_at: now,
  }));
}

/** True for a synthesized low-stock item, which has no persistent read state. */
export function isSynthetic(id: string): boolean {
  return id.startsWith(LOW_STOCK_ID_PREFIX);
}
