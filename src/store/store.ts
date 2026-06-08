import { configureStore } from "@reduxjs/toolkit";
import { salesSlice } from "@/app/dashboard/sales/_store/salesSlice";
import { expensesSlice } from "@/app/dashboard/expenses/_store/expensesSlice";
import { purchasesSlice } from "@/app/dashboard/purchases/_store/purchasesSlice";
import { inventorySlice } from "@/app/dashboard/inventory/_store/inventorySlice";
import { auditLogsSlice } from "./slices/auditLogsSlice";
import { usersSlice } from "@/app/dashboard/users/_store/usersSlice";
import { currentUserSlice } from "./slices/currentUserSlice";

export const makeStore = () =>
  configureStore({
    reducer: {
      sales: salesSlice.reducer,
      expenses: expensesSlice.reducer,
      purchases: purchasesSlice.reducer,
      inventory: inventorySlice.reducer,
      auditLogs: auditLogsSlice.reducer,
      users: usersSlice.reducer,
      currentUser: currentUserSlice.reducer,
    },
  });

// Types
export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
