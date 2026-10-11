import {
  hydrateAccounts,
  hydrateConnections,
  integrationsSlice,
  setConnectionStatus,
  upsertConnection,
} from "./integrationsSlice";
import type { PlatformAccount, PlatformConnection } from "@/types";

const makeConnection = (overrides: Partial<PlatformConnection> = {}): PlatformConnection => ({
  id: "conn-1",
  platform: "ebay",
  status: "connected",
  external_account_id: "u-1",
  external_username: "store_one",
  display_name: "Store one",
  is_active: true,
  marketplace_id: null,
  last_synced_at: null,
  last_sync_status: null,
  last_sync_error: null,
  created_at: "2026-06-01T10:00:00.000Z",
  updated_at: "2026-06-01T10:00:00.000Z",
  ...overrides,
});

const toAccount = (c: PlatformConnection): PlatformAccount => ({
  id: c.id, platform: c.platform, display_name: c.display_name, status: c.status, is_active: c.is_active, created_at: c.created_at,
});

describe("integrationsSlice", () => {
  const { reducer } = integrationsSlice;

  it("starts empty", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state).toEqual({ connections: [], accounts: [] });
  });

  it("hydrates connections and accounts independently", () => {
    const c = makeConnection();
    let state = reducer(undefined, hydrateConnections([c]));
    state = reducer(state, hydrateAccounts([toAccount(c)]));
    expect(state.connections).toEqual([c]);
    expect(state.accounts).toEqual([toAccount(c)]);
  });

  it("keeps two accounts of the same platform side by side", () => {
    const a = makeConnection();
    const b = makeConnection({ id: "conn-2", external_account_id: "u-2", display_name: "Store two" });
    const state = reducer(reducer(undefined, upsertConnection(a)), upsertConnection(b));
    expect(state.connections.map((c) => c.id)).toEqual(["conn-1", "conn-2"]);
  });

  it("replaces by id and mirrors into accounts", () => {
    const a = makeConnection();
    let state = reducer(undefined, hydrateConnections([a]));
    state = reducer(state, hydrateAccounts([toAccount(a)]));
    state = reducer(state, upsertConnection({ ...a, display_name: "Renamed", is_active: false }));
    expect(state.connections[0].display_name).toBe("Renamed");
    expect(state.accounts[0]).toMatchObject({ display_name: "Renamed", is_active: false });
  });

  it("adds a new connection to accounts too", () => {
    const state = reducer(undefined, upsertConnection(makeConnection()));
    expect(state.accounts.map((a) => a.id)).toEqual(["conn-1"]);
  });

  it("sets status by id and leaves other accounts alone", () => {
    const a = makeConnection();
    const b = makeConnection({ id: "conn-2" });
    let state = reducer(undefined, hydrateConnections([a, b]));
    state = reducer(state, hydrateAccounts([toAccount(a), toAccount(b)]));
    state = reducer(state, setConnectionStatus({ id: "conn-2", status: "disconnected" }));
    expect(state.connections.map((c) => c.status)).toEqual(["connected", "disconnected"]);
    expect(state.accounts.map((c) => c.status)).toEqual(["connected", "disconnected"]);
  });

  it("ignores a status update for an unknown id", () => {
    const state = reducer(reducer(undefined, hydrateConnections([makeConnection()])), setConnectionStatus({ id: "nope", status: "error" }));
    expect(state.connections[0].status).toBe("connected");
  });
});
