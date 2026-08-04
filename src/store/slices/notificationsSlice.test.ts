import { notificationsSlice, hydrateNotifications, markAllRead, dismissOne, setFetching, fetchNotifications } from "./notificationsSlice";
import type { Notification } from "@/types";

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

describe("notificationsSlice", () => {
  it("starts empty and unloaded", () => {
    const s = reducer(undefined, { type: "@@INIT" });
    expect(s.items).toEqual([]);
    expect(s.loaded).toBe(false);
    expect(s.readThrough).toBeNull();
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

  // Regression guard: a fetch that restored only `items` would leave
  // readThrough/readIds empty, so every poll would re-count read items as
  // unread and silently undo "mark all read".
  it("fetchNotifications.fulfilled restores all three pieces of read state", () => {
    const s = reducer(undefined, {
      type: fetchNotifications.fulfilled.type,
      payload: {
        data: [make("a")],
        readIds: ["a"],
        readThrough: "2026-08-02T00:00:00Z",
      },
    });
    expect(s.items).toHaveLength(1);
    expect(s.readIds).toEqual(["a"]);
    expect(s.readThrough).toBe("2026-08-02T00:00:00Z");
    expect(s.isFetching).toBe(false);
  });

  it("dismissOne ignores synthetic ids (low-stock:*)", () => {
    let s = reducer(undefined, hydrateNotifications({ data: [make("a")], readThrough: null, readIds: [] }));
    s = reducer(s, dismissOne("low-stock:prod-1"));
    expect(s.readIds).toEqual([]);
  });
});
