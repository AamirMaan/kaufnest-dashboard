"use client";

import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { hasAdvancedInventory } from "@/lib/utils/planGating";
import { advancedInventoryView } from "../_lib/advancedInventory";
import { fetchAdvancedInventory } from "./advancedInventorySlice";

/**
 * The one entry point for advanced-inventory state outside the slice:
 * Inventory page, Purchases/Sales modals and the order page. Loads (or
 * refreshes, if older than ADVANCED_INVENTORY_STALE_MS) on mount when the
 * plan allows it; never for Starter/Pro.
 */
export function useAdvancedInventory() {
  const dispatch = useAppDispatch();
  const plan = useAppSelector((s) => s.currentUser.tenantPlan);
  const state = useAppSelector((s) => s.advancedInventory);
  const entitled = !!plan && hasAdvancedInventory(plan);

  useEffect(() => {
    if (entitled) dispatch(fetchAdvancedInventory());
  }, [entitled, dispatch]);

  const reload = useCallback(() => {
    dispatch(fetchAdvancedInventory({ force: true }));
  }, [dispatch]);

  const view = advancedInventoryView(plan, state);
  return {
    entitled,
    active: view === "active",
    view,
    settings: state.settings,
    locations: state.locations,
    platformDefaults: state.platformDefaults,
    loading: state.loading,
    error: state.error,
    reload,
  };
}
