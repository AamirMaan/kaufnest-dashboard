"use client";

import { useState } from "react";
import { Provider } from "react-redux";
import { makeStore } from "@/store/store";
import { hydrateSales } from "@/app/dashboard/sales/_store/salesSlice";
import { hydrateExpenses } from "@/app/dashboard/expenses/_store/expensesSlice";
import { hydratePurchases } from "@/app/dashboard/purchases/_store/purchasesSlice";
import { hydrateProducts } from "@/app/dashboard/inventory/_store/inventorySlice";
import { hydrateAuditLogs } from "@/store/slices/auditLogsSlice";
import { hydrateUsers } from "@/app/dashboard/users/_store/usersSlice";
import { setCurrentUser, setTenantPlan } from "@/store/slices/currentUserSlice";
import { hydrateCompanyProfile } from "@/store/slices/companyProfileSlice";
import { hydrateConnections } from "@/app/dashboard/integrations/_store/integrationsSlice";
import type {
  Sale,
  Expense,
  Purchase,
  Product,
  AuditLog,
  Profile,
  CompanyProfile,
  TenantPlan,
  PlatformConnection,
} from "@/types";

interface StoreProviderProps {
  children: React.ReactNode;
  sales?: Sale[];
  expenses?: Expense[];
  purchases?: Purchase[];
  products?: Product[];
  auditLogs?: AuditLog[];
  users?: Profile[];
  currentUser?: Profile;
  companyProfile?: CompanyProfile;
  tenantPlan?: TenantPlan | null;
  platformConnections?: PlatformConnection[];
}

export function StoreProvider({
  children,
  sales,
  expenses,
  purchases,
  products,
  auditLogs,
  users,
  currentUser,
  companyProfile,
  tenantPlan,
  platformConnections,
}: StoreProviderProps) {
  const [store] = useState(() => {
    const store = makeStore();
    if (sales)               store.dispatch(hydrateSales(sales));
    if (expenses)            store.dispatch(hydrateExpenses(expenses));
    if (purchases)           store.dispatch(hydratePurchases(purchases));
    if (products)            store.dispatch(hydrateProducts(products));
    if (auditLogs)           store.dispatch(hydrateAuditLogs(auditLogs));
    if (users)               store.dispatch(hydrateUsers(users));
    if (currentUser)         store.dispatch(setCurrentUser(currentUser));
    if (companyProfile)      store.dispatch(hydrateCompanyProfile(companyProfile));
    if (tenantPlan)          store.dispatch(setTenantPlan(tenantPlan));
    if (platformConnections) store.dispatch(hydrateConnections(platformConnections));
    return store;
  });

  return <Provider store={store}>{children}</Provider>;
}
