"use client";

import { useState } from "react";
import { Provider } from "react-redux";
import { makeStore } from "@/store/store";
import { hydrateSales } from "@/app/dashboard/sales/_store/salesSlice";
import { hydrateExpenses } from "@/app/dashboard/expenses/_store/expensesSlice";
import { DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";
import { hydratePurchases } from "@/app/dashboard/purchases/_store/purchasesSlice";
import { hydrateProducts } from "@/app/dashboard/inventory/_store/inventorySlice";
import { hydrateAuditLogs } from "@/store/slices/auditLogsSlice";
import { hydrateUsers } from "@/app/dashboard/users/_store/usersSlice";
import { setCurrentUser, setTenantPlan } from "@/store/slices/currentUserSlice";
import { hydrateCompanyProfile } from "@/store/slices/companyProfileSlice";
import { hydrateConnections } from "@/app/dashboard/integrations/_store/integrationsSlice";
import { hydrateListings } from "@/app/dashboard/dropshipping/_store/dropshippingSlice";
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
  DropshipListing,
} from "@/types";

interface StoreProviderProps {
  children: React.ReactNode;
  sales?: { data: Sale[]; count: number };
  expenses?: { data: Expense[]; count: number };
  purchases?: { data: Purchase[]; count: number };
  products?: Product[];
  auditLogs?: { data: AuditLog[]; count: number };
  users?: Profile[];
  currentUser?: Profile;
  companyProfile?: CompanyProfile;
  tenantPlan?: TenantPlan | null;
  platformConnections?: PlatformConnection[];
  dropshipListings?: DropshipListing[];
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
  dropshipListings,
}: StoreProviderProps) {
  const [store] = useState(() => {
    const store = makeStore();
    if (sales)               store.dispatch(hydrateSales({ data: sales.data, count: sales.count, page: 1, pageSize: DEFAULT_PAGE_SIZE }));
    if (expenses)            store.dispatch(hydrateExpenses({ data: expenses.data, count: expenses.count, page: 1, pageSize: DEFAULT_PAGE_SIZE }));
    if (purchases)           store.dispatch(hydratePurchases({ data: purchases.data, count: purchases.count, page: 1, pageSize: DEFAULT_PAGE_SIZE }));
    if (products)            store.dispatch(hydrateProducts(products));
    if (auditLogs)           store.dispatch(hydrateAuditLogs({ data: auditLogs.data, count: auditLogs.count, page: 1, pageSize: DEFAULT_PAGE_SIZE }));
    if (users)               store.dispatch(hydrateUsers(users));
    if (currentUser)         store.dispatch(setCurrentUser(currentUser));
    if (companyProfile)      store.dispatch(hydrateCompanyProfile(companyProfile));
    if (tenantPlan)          store.dispatch(setTenantPlan(tenantPlan));
    if (platformConnections) store.dispatch(hydrateConnections(platformConnections));
    if (dropshipListings)    store.dispatch(hydrateListings(dropshipListings));
    return store;
  });

  return <Provider store={store}>{children}</Provider>;
}
