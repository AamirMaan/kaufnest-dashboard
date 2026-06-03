import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AuditLog } from "@/types";

interface AuditLogsState {
  items: AuditLog[];
  loaded: boolean;
}

const initialState: AuditLogsState = {
  items: [],
  loaded: false,
};

export const auditLogsSlice = createSlice({
  name: "auditLogs",
  initialState,
  reducers: {
    hydrate(state, action: PayloadAction<AuditLog[]>) {
      state.items = action.payload;
      state.loaded = true;
    },
  },
});

export const { hydrate: hydrateAuditLogs } = auditLogsSlice.actions;
