import { configureStore } from "@reduxjs/toolkit";
import { salesSlice } from "./slices/salesSlice";
import { expensesSlice } from "./slices/expensesSlice";
import { purchasesSlice } from "./slices/purchasesSlice";
import { auditLogsSlice } from "./slices/auditLogsSlice";
import { usersSlice } from "./slices/usersSlice";
import { currentUserSlice } from "./slices/currentUserSlice";

export const makeStore = () =>
  configureStore({
    reducer: {
      sales: salesSlice.reducer,
      expenses: expensesSlice.reducer,
      purchases: purchasesSlice.reducer,
      auditLogs: auditLogsSlice.reducer,
      users: usersSlice.reducer,
      currentUser: currentUserSlice.reducer,
    },
  });

// Types
export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
