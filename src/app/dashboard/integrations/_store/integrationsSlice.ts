import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PlatformConnection } from "@/types";

interface IntegrationsState {
  connections: PlatformConnection[];
}

const initialState: IntegrationsState = { connections: [] };

export const integrationsSlice = createSlice({
  name: "integrations",
  initialState,
  reducers: {
    hydrateConnections(state, action: PayloadAction<PlatformConnection[]>) {
      state.connections = action.payload;
    },
    upsertConnection(state, action: PayloadAction<PlatformConnection>) {
      const index = state.connections.findIndex((c) => c.platform === action.payload.platform);
      if (index >= 0) {
        state.connections[index] = action.payload;
      } else {
        state.connections.push(action.payload);
      }
    },
    setConnectionStatus(
      state,
      action: PayloadAction<{ platform: PlatformConnection["platform"]; status: PlatformConnection["status"] }>
    ) {
      const connection = state.connections.find((c) => c.platform === action.payload.platform);
      if (connection) {
        connection.status = action.payload.status;
      }
    },
  },
});

export const { hydrateConnections, upsertConnection, setConnectionStatus } = integrationsSlice.actions;
