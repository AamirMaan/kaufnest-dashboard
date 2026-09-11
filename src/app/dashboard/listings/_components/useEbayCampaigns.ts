"use client";

import { useCallback, useEffect, useState } from "react";
import type { CampaignOption } from "../_lib/campaignSelection";

export type MarketingAccess =
  | { status: "loading" }
  | { status: "ready"; campaigns: CampaignOption[] }
  | { status: "reconnect" }
  | { status: "error"; message: string };

/** One fetch of the seller's campaigns, shared by the Pricing (multi-buy)
 *  and Advertising sections — `reconnect` gates both. */
export function useEbayCampaigns(): { access: MarketingAccess; reload: () => void } {
  const [access, setAccess] = useState<MarketingAccess>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Deferred via a microtask so the setState calls don't run synchronously
    // inside the effect body (react-hooks/set-state-in-effect; same pattern
    // as AspectsStep.tsx).
    Promise.resolve().then(async () => {
      setAccess({ status: "loading" });
      try {
        const res = await fetch("/api/listings/ebay/campaigns");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Couldn't load your campaigns.");
        if (cancelled) return;
        setAccess(
          json.needsReconnect
            ? { status: "reconnect" }
            : { status: "ready", campaigns: json.campaigns as CampaignOption[] }
        );
      } catch (err) {
        if (cancelled) return;
        setAccess({
          status: "error",
          message: err instanceof Error ? err.message : "Couldn't load your campaigns.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { access, reload };
}
