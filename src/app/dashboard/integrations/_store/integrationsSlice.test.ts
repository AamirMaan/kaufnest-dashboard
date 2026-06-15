import {
  hydrateConnections,
  integrationsSlice,
  setConnectionStatus,
  upsertConnection,
} from "./integrationsSlice";
import type { PlatformConnection } from "@/types";

const makeConnection = (overrides: Partial<PlatformConnection> = {}): PlatformConnection => ({
  id: "conn-1",
  platform: "ebay",
  status: "disconnected",
  external_account_id: null,
  marketplace_id: null,
  last_synced_at: null,
  last_sync_status: null,
  last_sync_error: null,
  updated_at: "2026-06-01T10:00:00.000Z",
  ...overrides,
});

describe("integrationsSlice", () => {
  const { reducer } = integrationsSlice;

  it("starts with no connections", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.connections).toEqual([]);
  });

  it("hydrates connections", () => {
    const connections = [makeConnection(), makeConnection({ id: "conn-2", platform: "amazon" })];
    const state = reducer(undefined, hydrateConnections(connections));
    expect(state.connections).toEqual(connections);
  });

  it("upserts a new connection", () => {
    const initial = reducer(undefined, hydrateConnections([makeConnection()]));
    const amazon = makeConnection({ id: "conn-2", platform: "amazon", status: "connected" });
    const state = reducer(initial, upsertConnection(amazon));
    expect(state.connections).toEqual([makeConnection(), amazon]);
  });

  it("replaces an existing connection for the same platform", () => {
    const initial = reducer(undefined, hydrateConnections([makeConnection()]));
    const updated = makeConnection({ status: "connected", external_account_id: "seller123" });
    const state = reducer(initial, upsertConnection(updated));
    expect(state.connections).toEqual([updated]);
  });

  it("updates the status of an existing connection", () => {
    const initial = reducer(undefined, hydrateConnections([makeConnection({ status: "connected" })]));
    const state = reducer(initial, setConnectionStatus({ platform: "ebay", status: "error" }));
    expect(state.connections[0].status).toBe("error");
  });

  it("ignores a status update for a platform with no connection", () => {
    const initial = reducer(undefined, hydrateConnections([makeConnection()]));
    const state = reducer(initial, setConnectionStatus({ platform: "amazon", status: "connected" }));
    expect(state.connections).toEqual([makeConnection()]);
  });
});
