"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plug, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch } from "@/store/hooks";
import { formatDateTime } from "@/lib/utils/date";
import { setConnectionStatus } from "../_store/integrationsSlice";
import type { IntegrationPlatform, PlatformConnection } from "@/types";

const PLATFORM_LABELS: Record<IntegrationPlatform, string> = {
  ebay: "eBay",
  amazon: "Amazon",
};

const STATUS_VARIANTS: Record<PlatformConnection["status"], "default" | "success" | "danger"> = {
  connected: "success",
  disconnected: "default",
  error: "danger",
};

interface ConnectionCardProps {
  platform: IntegrationPlatform;
  connection?: PlatformConnection;
  canManage: boolean;
}

export function ConnectionCard({ platform, connection, canManage }: ConnectionCardProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const status = connection?.status ?? "disconnected";
  const label = PLATFORM_LABELS[platform];

  async function handleDisconnect() {
    setDisconnecting(true);
    const res = await fetch(`/api/integrations/${platform}/disconnect`, { method: "POST" });
    setDisconnecting(false);

    if (!res.ok) {
      toastError("Failed to disconnect", `${label} could not be disconnected.`);
      return;
    }

    dispatch(setConnectionStatus({ platform, status: "disconnected" }));
    success(`${label} disconnected`);
  }

  async function handleSync() {
    setSyncing(true);
    const res = await fetch(`/api/integrations/${platform}/sync`, { method: "POST" });
    const result = (await res.json()) as { ok: boolean; synced: number; error?: string };
    setSyncing(false);

    if (!result.ok) {
      dispatch(setConnectionStatus({ platform, status: "error" }));
      toastError("Sync failed", result.error ?? "Unknown error");
      return;
    }

    dispatch(setConnectionStatus({ platform, status: "connected" }));
    success("Sync complete", `${result.synced} order${result.synced === 1 ? "" : "s"} synced.`);
    if (result.synced > 0) {
      // Re-fetch server data so the sales/dashboard pages reflect the new orders
      router.refresh();
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-btn)] bg-[var(--color-surface-subtle)]">
            <Plug size={18} className="text-[var(--color-text-muted)]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-strong)]">{label}</h3>
            {connection?.external_account_id && (
              <p className="text-xs text-[var(--color-text-muted)]">{connection.external_account_id}</p>
            )}
          </div>
        </div>
        <Badge label={status.charAt(0).toUpperCase() + status.slice(1)} variant={STATUS_VARIANTS[status]} />
      </div>

      <div className="text-xs text-[var(--color-text-muted)] space-y-1">
        <p>Last synced: {connection?.last_synced_at ? formatDateTime(connection.last_synced_at) : "Never"}</p>
        {connection?.last_sync_error && <p className="text-[var(--color-danger-text)]">{connection.last_sync_error}</p>}
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          {status === "connected" ? (
            <>
              <Button size="sm" variant="secondary" onClick={handleSync} disabled={syncing}>
                <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => window.location.assign(`/api/integrations/${platform}/connect`)}>
              Connect {label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
