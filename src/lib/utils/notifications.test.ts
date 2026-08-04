import { isUnread, unreadCount, synthesizeLowStock, NOTIFICATION_LABELS, type UnreadContext } from "./notifications";
import type { Notification } from "@/types";

function make(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    type: "sale.created",
    category: "orders",
    entity_type: "sale",
    entity_id: "s1",
    title: "New order",
    body: null,
    link: "/dashboard/sales/s1",
    payload: null,
    actor_id: "someone-else",
    visible_to_roles: ["admin"],
    required_permission: null,
    created_at: "2026-08-03T12:00:00Z",
    ...overrides,
  };
}

const base: UnreadContext = {
  readThrough: null,
  readIds: new Set<string>(),
  currentUserId: "me",
};

describe("isUnread", () => {
  it("treats a fresh notification from someone else as unread", () => {
    expect(isUnread(make(), base)).toBe(true);
  });

  it("never marks your own action as unread", () => {
    expect(isUnread(make({ actor_id: "me" }), base)).toBe(false);
  });

  it("treats a notification at or before the watermark as read", () => {
    expect(isUnread(make(), { ...base, readThrough: "2026-08-03T12:00:00Z" })).toBe(false);
  });

  it("treats a notification after the watermark as unread", () => {
    expect(isUnread(make(), { ...base, readThrough: "2026-08-03T11:59:59Z" })).toBe(true);
  });

  it("treats an individually dismissed notification as read", () => {
    expect(isUnread(make(), { ...base, readIds: new Set(["n1"]) })).toBe(false);
  });

  it("counts externally-caused notifications (null actor) as unread", () => {
    expect(isUnread(make({ actor_id: null }), base)).toBe(true);
  });
});

describe("unreadCount", () => {
  it("counts only unread items", () => {
    const items = [
      make({ id: "a" }),
      make({ id: "b", actor_id: "me" }),
      make({ id: "c" }),
    ];
    expect(unreadCount(items, base)).toBe(2);
  });

  it("returns zero for an empty list", () => {
    expect(unreadCount([], base)).toBe(0);
  });
});

describe("NOTIFICATION_LABELS", () => {
  it("has a label for every notification type", () => {
    expect(NOTIFICATION_LABELS["sale.created"]).toBe("Orders");
    expect(NOTIFICATION_LABELS["purchase.created"]).toBe("Purchases");
    expect(NOTIFICATION_LABELS["product.low_stock"]).toBe("Inventory");
    expect(NOTIFICATION_LABELS["message.received"]).toBe("Messages");
  });
});

describe("synthesizeLowStock", () => {
  const product = {
    id: "p1", name: "Widget", sku: "W-1",
    current_stock: 2, reorder_threshold: 5,
  };

  it("builds a notification-shaped object with a prefixed, stable id", () => {
    const [n] = synthesizeLowStock([product]);
    expect(n.id).toBe("low-stock:p1");
    expect(n.type).toBe("product.low_stock");
    expect(n.category).toBe("inventory");
    expect(n.entity_id).toBe("p1");
    expect(n.link).toBe("/dashboard/inventory");
  });

  it("has a null actor so it is never suppressed as the viewer's own action", () => {
    const [n] = synthesizeLowStock([product]);
    expect(n.actor_id).toBeNull();
    expect(isUnread(n, { ...base, currentUserId: "anyone" })).toBe(true);
  });

  it("mentions the stock level and threshold in the body", () => {
    const [n] = synthesizeLowStock([product]);
    expect(n.body).toContain("2");
    expect(n.body).toContain("5");
  });

  it("returns an empty array for no low-stock products", () => {
    expect(synthesizeLowStock([])).toEqual([]);
  });

  it("filters out products that are above their threshold", () => {
    const healthy = { ...product, id: "p2", current_stock: 50 };
    const result = synthesizeLowStock([product, healthy]);
    expect(result).toHaveLength(1);
    expect(result[0].entity_id).toBe("p1");
  });

  it("includes a product sitting exactly on its threshold", () => {
    const atThreshold = { ...product, current_stock: 5, reorder_threshold: 5 };
    expect(synthesizeLowStock([atThreshold])).toHaveLength(1);
  });

  it("produces the same id across repeated synthesis so polling does not duplicate", () => {
    const a = synthesizeLowStock([product])[0];
    const b = synthesizeLowStock([product])[0];
    expect(a.id).toBe(b.id);
  });
});
