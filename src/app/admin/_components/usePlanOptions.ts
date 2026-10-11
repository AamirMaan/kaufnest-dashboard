"use client";

import { useEffect, useState } from "react";
import type { Plan } from "@/lib/plans/entitlements";
import { planOptions } from "./planOptions";

/**
 * Plan <option>s for the Add/Edit tenant modals, fetched from GET /api/admin/plans
 * each time the modal opens. Until the catalog arrives (or if it fails to load)
 * the only option is `currentKey`, so the select is never empty and never
 * silently changes the tenant's plan.
 */
export function usePlanOptions(open: boolean, currentKey: string | null, fallbackKey: string) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/admin/plans")
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as { plans?: Plan[] };
        if (cancelled) return;
        if (!r.ok || !data.plans) {
          setError(true);
        } else {
          setPlans(data.plans);
          setError(false);
        }
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [open]);

  const options =
    plans && !error ? planOptions(plans, currentKey) : [{ value: fallbackKey, label: fallbackKey }];
  return { options, error };
}
