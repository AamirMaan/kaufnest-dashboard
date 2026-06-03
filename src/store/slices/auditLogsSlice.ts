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
    addAuditLog(state, action: PayloadAction<AuditLog>) {
      state.items.unshift(action.payload);
    },
  },
});

export const { hydrate: hydrateAuditLogs, addAuditLog } = auditLogsSlice.actions;
