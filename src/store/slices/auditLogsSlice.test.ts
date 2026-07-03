import {
  auditLogsSlice,
  hydrateAuditLogs,
  addAuditLog,
  hydratePage,
  setFetching,
} from "./auditLogsSlice";
import type { AuditLog } from "@/types";
import { DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";

const makeLog = (overrides: Partial<AuditLog> = {}): AuditLog => ({
  id: "log-1",
  user_id: "user-1",
  user_email: "admin@example.com",
  action: "create",
  entity_type: "sale",
  entity_id: "sale-1",
  metadata: null,
  created_at: "2026-06-01T10:00:00.000Z",
  ...overrides,
});

describe("auditLogsSlice", () => {
  const { reducer } = auditLogsSlice;

  it("starts empty with loaded=false", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it("starts with default pagination state", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(state.total).toBe(0);
    expect(state.isFetching).toBe(false);
  });

  it("hydratePage (hydrateAuditLogs alias) replaces items and sets pagination fields", () => {
    const logs = [makeLog(), makeLog({ id: "log-2" })];
    const state = reducer(
      undefined,
      hydratePage({ data: logs, count: 120, page: 2, pageSize: 50 })
    );
    expect(state.items).toHaveLength(2);
    expect(state.loaded).toBe(true);
    expect(state.page).toBe(2);
    expect(state.pageSize).toBe(50);
    expect(state.total).toBe(120);
    expect(state.isFetching).toBe(false);
  });

  it("hydrateAuditLogs alias works the same as hydratePage", () => {
    const logs = [makeLog()];
    const state = reducer(
      undefined,
      hydrateAuditLogs({ data: logs, count: 1, page: 1, pageSize: 50 })
    );
    expect(state.items).toHaveLength(1);
    expect(state.loaded).toBe(true);
    expect(state.total).toBe(1);
  });

  it("hydratePage page 1 works correctly", () => {
    const logs = [makeLog()];
    const state = reducer(
      undefined,
      hydratePage({ data: logs, count: 1, page: 1, pageSize: 50 })
    );
    expect(state.items).toHaveLength(1);
    expect(state.page).toBe(1);
    expect(state.total).toBe(1);
  });

  it("setFetching sets isFetching flag", () => {
    const state1 = reducer(undefined, setFetching(true));
    expect(state1.isFetching).toBe(true);
    const state2 = reducer(state1, setFetching(false));
    expect(state2.isFetching).toBe(false);
  });

  it("prepends a new log entry via addAuditLog and increments total", () => {
    const initial = reducer(
      undefined,
      hydratePage({ data: [makeLog({ id: "old" })], count: 1, page: 1, pageSize: 50 })
    );
    const newLog = makeLog({ id: "new", action: "delete" });
    const state = reducer(initial, addAuditLog(newLog));
    expect(state.items[0].id).toBe("new");
    expect(state.items).toHaveLength(2);
    expect(state.total).toBe(2);
  });

  it("addAuditLog increments total correctly from non-zero baseline", () => {
    const initial = reducer(
      undefined,
      hydratePage({ data: [makeLog({ id: "a" }), makeLog({ id: "b" })], count: 10, page: 1, pageSize: 50 })
    );
    const state = reducer(initial, addAuditLog(makeLog({ id: "c" })));
    expect(state.total).toBe(11);
  });

  it("preserves log immutability — existing logs unchanged after prepend", () => {
    const initial = reducer(
      undefined,
      hydratePage({ data: [makeLog({ id: "existing" })], count: 1, page: 1, pageSize: 50 })
    );
    const state = reducer(initial, addAuditLog(makeLog({ id: "new" })));
    expect(state.items[1].id).toBe("existing");
  });

  it("supports all audit action types", () => {
    const actions = ["create", "update", "delete", "login", "logout", "role_change"] as const;
    actions.forEach((action) => {
      const log = makeLog({ id: action, action });
      const state = reducer(undefined, addAuditLog(log));
      expect(state.items[0].action).toBe(action);
    });
  });

  it("supports all entity types", () => {
    const entities = ["expense", "purchase", "sale", "user"] as const;
    entities.forEach((entity_type) => {
      const log = makeLog({ id: entity_type, entity_type });
      const state = reducer(undefined, addAuditLog(log));
      expect(state.items[0].entity_type).toBe(entity_type);
    });
  });
});
