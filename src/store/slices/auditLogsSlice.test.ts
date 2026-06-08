import { auditLogsSlice, hydrateAuditLogs, addAuditLog } from "./auditLogsSlice";
import type { AuditLog } from "@/types";

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

  it("hydrates audit logs", () => {
    const logs = [makeLog(), makeLog({ id: "log-2" })];
    const state = reducer(undefined, hydrateAuditLogs(logs));
    expect(state.items).toHaveLength(2);
    expect(state.loaded).toBe(true);
  });

  it("prepends a new log entry via addAuditLog", () => {
    const initial = reducer(undefined, hydrateAuditLogs([makeLog({ id: "old" })]));
    const newLog = makeLog({ id: "new", action: "delete" });
    const state = reducer(initial, addAuditLog(newLog));
    expect(state.items[0].id).toBe("new");
    expect(state.items).toHaveLength(2);
  });

  it("preserves log immutability — existing logs unchanged after prepend", () => {
    const initial = reducer(undefined, hydrateAuditLogs([makeLog({ id: "existing" })]));
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
