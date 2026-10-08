"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Plug } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { useAppDispatch } from "@/store/hooks";
import { formatDateTime } from "@/lib/utils/date";
import { integrationErrorMessage } from "@/lib/utils/integrationErrors";
import type { AccountState } from "@/lib/utils/activeAccounts";
import { setConnectionStatus, upsertConnection } from "../_store/integrationsSlice";
import type { IntegrationPlatform, PlatformConnection } from "@/types";

const PLATFORM_LABELS: Record<IntegrationPlatform, string> = {
  ebay: "eBay",
  amazon: "Amazon",
};

const STATE_BADGES: Record<AccountState, { label: string; variant: "success" | "default" | "warning" | "danger" }> = {
  active: { label: "Active", variant: "success" },
  paused: { label: "Paused", variant: "default" },
  plan_limit: { label: "Paused — plan limit", variant: "warning" },
  disconnected: { label: "Disconnected", variant: "default" },
  error: { label: "Error", variant: "danger" },
};

interface ConnectionCardProps {
  connection: PlatformConnection;
  state: AccountState;
  canResume: boolean;
  canManage: boolean;
}

export function ConnectionCard({ connection, state, canResume, canManage }: ConnectionCardProps) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { id, platform } = connection;
  const label = PLATFORM_LABELS[platform];
  const displayName = connection.display_name ?? label;
  const subline = connection.external_username ?? connection.external_account_id;
  const badge = STATE_BADGES[state];
  const formId = `rename-${id}`;
  const isFormValid = name.trim().length > 0;

  async function patch(body: { display_name?: string; is_active?: boolean }) {
    const res = await fetch(`/api/integrations/connections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; connection?: PlatformConnection };
    return { ok: res.ok && !!json.connection, json };
  }

  function startRename() {
    setName(connection.display_name ?? "");
    setRenaming(true);
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid) return;
    setSaving(true);
    try {
      const { ok, json } = await patch({ display_name: name.trim() });
      if (ok && json.connection) {
        dispatch(upsertConnection(json.connection));
        success("Account renamed");
        setRenaming(false);
      } else {
        toastError("Couldn't rename account", integrationErrorMessage(json.error, json.error ?? "Please try again."));
      }
    } catch {
      toastError("Couldn't rename account", "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(isActive: boolean) {
    setToggling(true);
    try {
      const { ok, json } = await patch({ is_active: isActive });
      if (ok && json.connection) {
        dispatch(upsertConnection(json.connection));
        success(isActive ? "Account resumed" : "Account paused");
      } else {
        toastError(
          isActive ? "Couldn't resume account" : "Couldn't pause account",
          integrationErrorMessage(json.error, json.error ?? "Please try again.")
        );
      }
    } catch {
      toastError(isActive ? "Couldn't resume account" : "Couldn't pause account", "Please try again.");
    } finally {
      setToggling(false);
    }
  }

  async function handleDisconnect() {
    try {
      const res = await fetch(`/api/integrations/${platform}/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: id }),
      });
      if (!res.ok) {
        toastError("Failed to disconnect", "Please try again.");
        return;
      }
      dispatch(setConnectionStatus({ id, status: "disconnected" }));
      success(`${displayName} disconnected`);
      setConfirmOpen(false);
    } catch {
      toastError("Failed to disconnect", "Please try again.");
    }
  }

  const connected = state !== "disconnected";

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[var(--radius-btn)] bg-[var(--color-surface-subtle)]">
            <Plug size={18} className="text-[var(--color-text-muted)]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <h3 className="truncate text-sm font-semibold text-[var(--color-text-strong)]">{displayName}</h3>
              {canManage && !renaming && (
                <Button size="sm" variant="ghost" aria-label="Rename account" onClick={startRename}>
                  <Pencil size={14} />
                </Button>
              )}
            </div>
            {subline && subline !== displayName && (
              <p className="truncate text-xs text-[var(--color-text-muted)]">{subline}</p>
            )}
          </div>
        </div>
        <Badge label={badge.label} variant={badge.variant} />
      </div>

      {canManage && renaming && (
        <form id={formId} onSubmit={handleRename} className="flex items-center gap-2">
          <Input
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Account name"
            placeholder={label}
          />
          <Button type="submit" form={formId} size="sm" disabled={saving || !isFormValid}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)} disabled={saving}>
            Cancel
          </Button>
        </form>
      )}

      <div className="text-xs text-[var(--color-text-muted)] space-y-1">
        <p>Last synced: {connection.last_synced_at ? formatDateTime(connection.last_synced_at) : "Never"}</p>
        {connection.last_sync_error && <p className="text-[var(--color-danger-text)]">{connection.last_sync_error}</p>}
        {state === "plan_limit" && (
          <p>Pause another account to use this one, or upgrade your plan.</p>
        )}
        {state === "paused" && !canResume && canManage && (
          <p>Pause another account first, or upgrade your plan.</p>
        )}
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {connected ? (
            <>
              {(state === "active" || state === "plan_limit") && (
                <Button size="sm" variant="secondary" onClick={() => handleToggle(false)} disabled={toggling}>
                  {toggling ? "Pausing…" : "Pause"}
                </Button>
              )}
              {state === "paused" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleToggle(true)}
                  disabled={toggling || !canResume}
                >
                  {toggling ? "Resuming…" : "Resume"}
                </Button>
              )}
              <Link
                href="/dashboard/integrations/review"
                className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-btn)] font-semibold transition-colors cursor-pointer px-3 py-1.5 text-xs bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-text-base)] border border-[var(--color-border)]"
              >
                Review orders
              </Link>
              <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(true)}>
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => window.location.assign(`/api/integrations/${platform}/connect?reconnect=1`)}
            >
              Reconnect
            </Button>
          )}
        </div>
      )}

      <DeleteConfirmModal
        open={confirmOpen}
        title="Disconnect account?"
        description={`${displayName} will stop syncing. Its orders stay in your dashboard and reconnect automatically if you connect this account again.`}
        confirmLabel="Disconnect"
        confirmingLabel="Disconnecting…"
        requireReason={false}
        onConfirm={handleDisconnect}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}
