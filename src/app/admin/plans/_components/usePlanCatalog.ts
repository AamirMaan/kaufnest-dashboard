"use client";

import { useCallback, useEffect, useState } from "react";
import type { Plan } from "@/lib/plans/entitlements";

interface CatalogState {
  plans: Plan[] | null; // null = loading
  tenantCounts: Record<string, number>;
  error: string | null;
  /** Bumped on every successful load — key a form on it to remount with fresh data. */
  version: number;
}

/** GET /api/admin/plans for the /admin/plans pages, with a `reload()` for Retry / after a save. */
export function usePlanCatalog() {
  const [state, setState] = useState<CatalogState>({ plans: null, tenantCounts: {}, error: null, version: 0 });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/plans")
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as {
          plans?: Plan[];
          tenantCounts?: Record<string, number>;
          error?: string;
        };
        if (cancelled) return;
        if (!r.ok) {
          setState((s) => ({ ...s, plans: null, tenantCounts: {}, error: data.error ?? "Could not load plans." }));
          return;
        }
        setState((s) => ({ plans: data.plans ?? [], tenantCounts: data.tenantCounts ?? {}, error: null, version: s.version + 1 }));
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, plans: null, tenantCounts: {}, error: "Could not load plans." }));
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
    setRefreshKey((k) => k + 1);
  }, []);

  return { ...state, reload };
}
