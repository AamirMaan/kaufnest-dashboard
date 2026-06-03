"use client";

import { useRef } from "react";
import { Provider } from "react-redux";
import { makeStore, type AppStore } from "@/store/store";
import { hydrateSales } from "@/store/slices/salesSlice";
import { hydrateExpenses } from "@/store/slices/expensesSlice";
import { hydratePurchases } from "@/store/slices/purchasesSlice";
import { hydrateAuditLogs } from "@/store/slices/auditLogsSlice";
import { hydrateUsers } from "@/store/slices/usersSlice";
import type { Sale, Expense, Purchase, AuditLog, Profile } from "@/types";

interface StoreProviderProps {
  children: React.ReactNode;
  // Initial data pre-fetched by the server layout — all optional
  sales?: Sale[];
  expenses?: Expense[];
  purchases?: Purchase[];
  auditLogs?: AuditLog[];
  users?: Profile[];
}

/**
 * Wraps the dashboard in a Redux Provider.
 * The server layout fetches initial data and passes it here; the store is
 * hydrated once, so navigating between pages does NOT trigger refetches.
 */
export function StoreProvider({
  children,
  sales,
  expenses,
  purchases,
  auditLogs,
  users,
}: StoreProviderProps) {
  const storeRef = useRef<AppStore | null>(null);

  if (storeRef.current === null) {
    storeRef.current = makeStore();

    const store = storeRef.current;
    if (sales)     store.dispatch(hydrateSales(sales));
    if (expenses)  store.dispatch(hydrateExpenses(expenses));
    if (purchases) store.dispatch(hydratePurchases(purchases));
    if (auditLogs) store.dispatch(hydrateAuditLogs(auditLogs));
    if (users)     store.dispatch(hydrateUsers(users));
  }

  return <Provider store={storeRef.current}>{children}</Provider>;
}
