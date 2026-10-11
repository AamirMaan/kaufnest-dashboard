import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PlatformAccount, PlatformConnection } from "@/types";

interface IntegrationsState {
  /** Admin view (platform_connections, safe columns) — empty for non-admins (RLS). */
  connections: PlatformConnection[];
  /** Every tenant member (get_platform_accounts, 056) — for account filters/pickers. */
  accounts: PlatformAccount[];
}

const initialState: IntegrationsState = { connections: [], accounts: [] };

function toAccount(c: PlatformConnection): PlatformAccount {
  return { id: c.id, platform: c.platform, display_name: c.display_name, status: c.status, is_active: c.is_active, created_at: c.created_at };
}

export const integrationsSlice = createSlice({
  name: "integrations",
  initialState,
  reducers: {
    hydrateConnections(state, action: PayloadAction<PlatformConnection[]>) {
      state.connections = action.payload;
    },
    hydrateAccounts(state, action: PayloadAction<PlatformAccount[]>) {
      state.accounts = action.payload;
    },
    upsertConnection(state, action: PayloadAction<PlatformConnection>) {
      const c = action.payload;
      const i = state.connections.findIndex((x) => x.id === c.id);
      if (i >= 0) state.connections[i] = c;
      else state.connections.push(c);
      const j = state.accounts.findIndex((x) => x.id === c.id);
      if (j >= 0) state.accounts[j] = toAccount(c);
      else state.accounts.push(toAccount(c));
    },
    setConnectionStatus(state, action: PayloadAction<{ id: string; status: PlatformConnection["status"] }>) {
      const { id, status } = action.payload;
      const c = state.connections.find((x) => x.id === id);
      if (c) c.status = status;
      const a = state.accounts.find((x) => x.id === id);
      if (a) a.status = status;
    },
  },
});

export const { hydrateConnections, hydrateAccounts, upsertConnection, setConnectionStatus } = integrationsSlice.actions;
