"use client";

import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { hasAdvancedInventory } from "@/lib/plans/entitlements";
import { usePlan } from "@/store/usePlan";
import { advancedInventoryView } from "../_lib/advancedInventory";
import { fetchAdvancedInventory } from "./advancedInventorySlice";

/**
 * The one entry point for advanced-inventory state outside the slice:
 * Inventory page, Purchases/Sales modals and the order page. Loads (or
 * refreshes, if older than ADVANCED_INVENTORY_STALE_MS) on mount when the
 * plan includes advanced inventory (`usePlan().ent`); never otherwise.
 */
export function useAdvancedInventory() {
  const dispatch = useAppDispatch();
  const { ent } = usePlan();
  const state = useAppSelector((s) => s.advancedInventory);
  const entitled = !!ent && hasAdvancedInventory(ent);

  useEffect(() => {
    if (entitled) dispatch(fetchAdvancedInventory());
  }, [entitled, dispatch]);

  const reload = useCallback(() => {
    dispatch(fetchAdvancedInventory({ force: true }));
  }, [dispatch]);

  const view = advancedInventoryView(ent, state);
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
