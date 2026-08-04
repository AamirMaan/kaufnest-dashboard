import { notificationsSlice, hydrateNotifications, markAllRead, dismissOne, setFetching, fetchNotifications } from "./notificationsSlice";
import type { Notification } from "@/types";
import type { LowStockProduct } from "@/lib/utils/notifications";

const reducer = notificationsSlice.reducer;

function make(id: string): Notification {
  return {
    id, type: "sale.created", category: "orders",
    entity_type: "sale", entity_id: "s1", title: "New order",
    body: null, link: null, payload: null, actor_id: "other",
    visible_to_roles: ["admin"], required_permission: null,
    created_at: "2026-08-03T12:00:00Z",
  };
}

function makeProduct(id: string, name: string, current_stock: number, reorder_threshold: number): LowStockProduct {
  return { id, name, sku: null, current_stock, reorder_threshold };
}

describe("notificationsSlice", () => {
  it("starts empty and unloaded", () => {
    const s = reducer(undefined, { type: "@@INIT" });
    expect(s.items).toEqual([]);
    expect(s.loaded).toBe(false);
    expect(s.readThrough).toBeNull();
    expect(s.lowStock).toEqual([]);
  });

  it("hydrates items and the watermark", () => {
    const s = reducer(undefined, hydrateNotifications({
      data: [make("a"), make("b")],
      readThrough: "2026-08-01T00:00:00Z",
      readIds: ["a"],
    }));
    expect(s.items).toHaveLength(2);
    expect(s.readThrough).toBe("2026-08-01T00:00:00Z");
    expect(s.readIds).toEqual(["a"]);
    expect(s.loaded).toBe(true);
  });

  it("hydrates lowStock when provided", () => {
    const products = [makeProduct("p1", "Widget", 2, 5)];
    const s = reducer(undefined, hydrateNotifications({
      data: [make("a")],
      readThrough: null,
      readIds: [],
      lowStock: products,
    }));
    expect(s.lowStock).toEqual(products);
    expect(s.loaded).toBe(true);
  });

  it("markAllRead advances the watermark and clears per-id dismissals", () => {
    let s = reducer(undefined, hydrateNotifications({
      data: [make("a")], readThrough: null, readIds: ["a"],
    }));
    s = reducer(s, markAllRead("2026-08-03T13:00:00Z"));
    expect(s.readThrough).toBe("2026-08-03T13:00:00Z");
    expect(s.readIds).toEqual([]);
  });

  it("dismissOne adds an id without duplicating", () => {
    let s = reducer(undefined, hydrateNotifications({ data: [make("a")], readThrough: null, readIds: [] }));
    s = reducer(s, dismissOne("a"));
    s = reducer(s, dismissOne("a"));
    expect(s.readIds).toEqual(["a"]);
  });

  it("setFetching toggles the flag", () => {
    const s = reducer(undefined, setFetching(true));
    expect(s.isFetching).toBe(true);
  });

  it("dismissOne ignores synthetic ids (low-stock:*)", () => {
    let s = reducer(undefined, hydrateNotifications({ data: [make("a")], readThrough: null, readIds: [] }));
    s = reducer(s, dismissOne("low-stock:prod-1"));
    expect(s.readIds).toEqual([]);
  });

  // Regression guard: a fetch that restored only items/reads/watermark without lowStock
  // would leave lowStock empty, so every poll would miss low-stock items. A fetch that
  // omitted any of the four fields (items, readIds, readThrough, lowStock) from state
  // would cause stale data on the next poll.
  it("fetchNotifications.fulfilled restores all four pieces of state", () => {
    const products = [makeProduct("p1", "Widget", 2, 5)];
    const s = reducer(undefined, {
      type: fetchNotifications.fulfilled.type,
      payload: {
        data: [make("a")],
        readIds: ["a"],
        readThrough: "2026-08-02T00:00:00Z",
        lowStock: products,
      },
    });
    expect(s.items).toHaveLength(1);
    expect(s.readIds).toEqual(["a"]);
    expect(s.readThrough).toBe("2026-08-02T00:00:00Z");
    expect(s.lowStock).toEqual(products);
    expect(s.isFetching).toBe(false);
    expect(s.loaded).toBe(true);
  });

  it("fetchNotifications.pending sets isFetching to true", () => {
    let s = reducer(undefined, hydrateNotifications({
      data: [make("a")],
      readThrough: "2026-08-02T00:00:00Z",
      readIds: [],
    }));
    s = reducer(s, { type: fetchNotifications.pending.type });
    expect(s.isFetching).toBe(true);
    // Existing state is preserved
    expect(s.items).toHaveLength(1);
    expect(s.readThrough).toBe("2026-08-02T00:00:00Z");
  });

  it("fetchNotifications.rejected sets isFetching to false and preserves existing state", () => {
    const products = [makeProduct("p1", "Widget", 2, 5)];
    let s = reducer(undefined, hydrateNotifications({
      data: [make("a")],
      readThrough: "2026-08-02T00:00:00Z",
      readIds: ["a"],
      lowStock: products,
    }));
    s = reducer(s, { type: fetchNotifications.rejected.type });
    expect(s.isFetching).toBe(false);
    // All existing state must be preserved so the bell continues showing stale data
    // rather than blanking until the next successful poll
    expect(s.items).toHaveLength(1);
    expect(s.readIds).toEqual(["a"]);
    expect(s.readThrough).toBe("2026-08-02T00:00:00Z");
    expect(s.lowStock).toEqual(products);
    expect(s.loaded).toBe(true);
  });
});
