import { configureStore } from "@reduxjs/toolkit";
import { salesSlice } from "@/app/dashboard/sales/_store/salesSlice";
import { expensesSlice } from "@/app/dashboard/expenses/_store/expensesSlice";
import { purchasesSlice } from "@/app/dashboard/purchases/_store/purchasesSlice";
import { inventorySlice } from "@/app/dashboard/inventory/_store/inventorySlice";
import { auditLogsSlice } from "./slices/auditLogsSlice";
import { usersSlice } from "@/app/dashboard/users/_store/usersSlice";
import { currentUserSlice } from "./slices/currentUserSlice";
import { companyProfileSlice } from "./slices/companyProfileSlice";
import { integrationsSlice } from "@/app/dashboard/integrations/_store/integrationsSlice";
import { dropshippingSlice } from "@/app/dashboard/dropshipping/_store/dropshippingSlice";
import { platformPayoutsSlice } from "./slices/platformPayoutsSlice";
import { listingsSlice } from "@/app/dashboard/listings/_store/listingsSlice";
import { messagesSlice } from "@/app/dashboard/messages/_store/messagesSlice";

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
      companyProfile: companyProfileSlice.reducer,
      integrations: integrationsSlice.reducer,
      dropshipping: dropshippingSlice.reducer,
      platformPayouts: platformPayoutsSlice.reducer,
      listings: listingsSlice.reducer,
      messages: messagesSlice.reducer,
    },
  });

// Types
export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
