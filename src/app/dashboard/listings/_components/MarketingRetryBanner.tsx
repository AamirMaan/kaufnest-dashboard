"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch } from "@/store/hooks";
import { createTenantClient } from "@/lib/supabase/client";
import { updateListingDraft } from "../_store/listingsSlice";
import type { EbayListingDraft } from "@/types";

/** Shown on a live listing whose ad or multi-buy discount failed after
 *  publish. Retry re-runs only the missing steps (never duplicates). */
export function MarketingRetryBanner({ draftId }: { draftId: string }) {
  const dispatch = useAppDispatch();
  const { success, error: toastError, warning } = useToast();
  const [message, setMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      const supabase = await createTenantClient();
      const { data } = await supabase
        .from("ebay_listing_drafts")
        .select("marketing_error")
        .eq("id", draftId)
        .maybeSingle<Pick<EbayListingDraft, "marketing_error">>();
      if (!cancelled) setMessage(data?.marketing_error ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  async function retry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/listings/${draftId}/apply-marketing`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Retry failed.");
      dispatch(updateListingDraft(json.draft));
      const warnings: string[] = json.warnings ?? [];
      if (warnings.length > 0) {
        setMessage(warnings.join(" "));
        warning("Still couldn't apply everything.", warnings.join(" "));
      } else {
        setMessage(null);
        success("Advertising and discounts applied.");
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  }

  if (!message) return null;

  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-start gap-3 rounded-(--radius-btn) border border-[var(--color-warning-text)]/30 bg-(--color-warning-bg) px-4 py-3 text-sm text-(--color-warning-text)"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <p className="flex-1">
        This listing is live, but advertising or the multi-buy discount wasn&apos;t applied:{" "}
        {message}
      </p>
      <Button type="button" variant="secondary" size="sm" onClick={retry} disabled={retrying}>
        <RefreshCw size={14} className={retrying ? "animate-spin" : undefined} />
        {retrying ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}
