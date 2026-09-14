"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

/**
 * Header action for /admin/support — POSTs the manual resync sweep and
 * reports the { checked, updated } counts via toast. Disabled + busy-label
 * pattern copied from TenantDetailActions.tsx's "Resend Invite" button
 * (same folder tree, src/app/admin/_components/TenantDetailActions.tsx).
 */
export function ResyncButton() {
  const { success, error: toastError } = useToast();
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  async function handleResync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/support/resync", { method: "POST" });
      const data = (await res.json()) as {
        checked?: number;
        updated?: number;
        failed?: number;
        error?: string;
      };

      if (res.ok) {
        const failed = data.failed ?? 0;
        success(
          "Synced with Trello",
          `Checked ${data.checked ?? 0} report${data.checked === 1 ? "" : "s"}, updated ${data.updated ?? 0}.` +
            (failed > 0 ? ` ${failed} failed — see server logs.` : "")
        );
        router.refresh();
      } else {
        toastError("Sync failed", data.error ?? "Could not sync with Trello.");
      }
    } catch {
      toastError("Sync failed", "Network error — please try again.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button variant="secondary" onClick={handleResync} disabled={syncing}>
      <RefreshCw size={14} className={syncing ? "animate-spin" : undefined} />
      {syncing ? "Syncing…" : "Sync with Trello"}
    </Button>
  );
}
