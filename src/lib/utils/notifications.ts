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
 * `actor_id` is null for externally-caused events (an inbound buyer message).
 * Such events cannot be suppressed by the own-action rule because nobody in
 * the tenant caused them, though they still fall through watermark and
 * dismissal checks.
 */
export function isUnread(n: Notification, ctx: UnreadContext): boolean {
  if (n.actor_id !== null && n.actor_id === ctx.currentUserId) return false;
  if (ctx.readIds.has(n.id)) return false;
  if (ctx.readThrough !== null && n.created_at <= ctx.readThrough) return false;
  return true;
}

/**
 * Count of unread STORED events only — synthetic low-stock items (see
 * `isSynthetic`) are deliberately excluded from the aggregate count, even
 * though `isUnread` still classifies them (used per-row, for the "unread"
 * style in the feed). A low-stock item is a live condition, not an unseen
 * event: `synthesizeLowStock` restamps its `created_at` to "now" on every
 * call, so if it counted here, "mark all read" would set the watermark to
 * that same instant and the very next render would restamp it past the new
 * watermark — unread again. Counting it would produce a badge that can
 * never reach zero.
 */
export function unreadCount(items: Notification[], ctx: UnreadContext): number {
  return items.reduce(
    (total, n) => (!isSynthetic(n.id) && isUnread(n, ctx) ? total + 1 : total),
    0,
  );
}

/**
 * Newest `created_at` among STORED notifications only — never synthetic
 * items, whose timestamp is stamped client-side at render time rather than
 * by Postgres. Used to derive the "mark all read" watermark from
 * server-generated data instead of the local clock (see `NotificationBell`'s
 * `handleMarkAllRead`): the local clock could be skewed relative to
 * Postgres, and a fast client clock would push the watermark ahead of the
 * server, silently hiding notifications created in the skew window.
 *
 * Returns null when `items` is empty — the caller should fall back to the
 * local clock only in that case, since there is nothing server-generated to
 * derive a watermark from.
 */
export function latestStoredTimestamp(items: Notification[]): string | null {
  if (items.length === 0) return null;
  return items.reduce(
    (latest, n) => (n.created_at > latest ? n.created_at : latest),
    items[0].created_at,
  );
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

/**
 * Merge stored notification rows with synthesized low-stock items into the
 * single feed the bell renders.
 *
 * Do NOT sort this result by `created_at`. `synthesizeLowStock` regenerates
 * that timestamp on every call (it is "now" at render time, not a stored
 * value), so a sort would churn low-stock items to the top of the feed on
 * every 60-second poll even though nothing about them changed. Their *id* is
 * stable across calls — it is only the timestamp that is volatile — so the
 * feed instead keeps a fixed order: stored events first (already
 * newest-first from the query), synthesized low-stock items after.
 */
export function buildFeed(
  stored: Notification[],
  lowStockProducts: LowStockProduct[],
): Notification[] {
  return [...stored, ...synthesizeLowStock(lowStockProducts)];
}
