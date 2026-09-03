"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { EditTenantModal } from "./EditTenantModal";
import { DeleteTenantModal } from "./DeleteTenantModal";
import { ConfirmActionModal } from "./ConfirmActionModal";
import { Pencil, Sparkles, Mail, UserCog, Trash2 } from "lucide-react";
import type { Tenant } from "@/types";

interface Props {
  tenant: Tenant;
  onRefresh: () => void;
}

export function TenantDetailActions({ tenant, onRefresh }: Props) {
  const { success, error: toastError } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resending, setResending] = useState(false);

  const [aiConfirmOpen, setAiConfirmOpen] = useState(false);
  const [togglingAi, setTogglingAi] = useState(false);

  const [impersonateConfirmOpen, setImpersonateConfirmOpen] = useState(false);
  const [impersonating, setImpersonating] = useState(false);

  async function handleResendInvite() {
    setResending(true);
    try {
      const res = await fetch("/api/admin/resend-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok) {
        success("Invite resent", `A new invite link was sent to ${tenant.admin_email}.`);
      } else {
        toastError("Resend failed", data.error ?? "Could not resend invite.");
      }
    } finally {
      setResending(false);
    }
  }

  async function handleConfirmToggleAi() {
    setTogglingAi(true);
    try {
      const next = !tenant.ai_enabled;
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai_enabled: next }),
      });
      const data = (await res.json()) as { tenant?: Tenant; error?: string };
      if (res.ok) {
        success(
          next ? "AI enabled" : "AI hidden",
          next
            ? `${tenant.name} can now see AI features.`
            : `AI features are now hidden for ${tenant.name}.`
        );
        setAiConfirmOpen(false);
        onRefresh();
      } else {
        toastError("Could not update AI visibility", data.error ?? "Please try again.");
      }
    } finally {
      setTogglingAi(false);
    }
  }

  async function handleConfirmImpersonate() {
    setImpersonating(true);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id }),
      });

      const data = (await res.json()) as { ok?: boolean; magicLink?: string; error?: string };

      if (!res.ok || !data.magicLink) {
        toastError("Impersonation failed", data.error ?? "Please try again.");
        setImpersonating(false);
        return;
      }

      window.location.href = data.magicLink;
    } catch {
      toastError("Impersonation failed", "Network error — please try again.");
      setImpersonating(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setEditOpen(true)}>
          <Pencil size={14} />
          Edit
        </Button>

        <Button variant="secondary" onClick={() => setAiConfirmOpen(true)}>
          <Sparkles
            size={14}
            className={tenant.ai_enabled ? "text-(--color-success-text)" : "text-(--color-text-faint)"}
          />
          {tenant.ai_enabled ? "AI: On" : "AI: Off"}
        </Button>

        {tenant.status === "invited" && (
          <Button variant="secondary" onClick={handleResendInvite} disabled={resending}>
            <Mail size={14} className="text-(--color-info-text)" />
            {resending ? "Sending…" : "Resend Invite"}
          </Button>
        )}

        <Button variant="secondary" onClick={() => setImpersonateConfirmOpen(true)}>
          <UserCog size={14} className="text-(--color-warning-text)" />
          Impersonate
        </Button>

        <Button variant="danger" onClick={() => setDeleteOpen(true)}>
          <Trash2 size={14} />
          Delete
        </Button>
      </div>

      <EditTenantModal
        open={editOpen}
        tenant={tenant}
        onClose={() => {
          setEditOpen(false);
          onRefresh();
        }}
      />
      <DeleteTenantModal
        open={deleteOpen}
        tenant={tenant}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false);
          onRefresh();
        }}
      />
      <ConfirmActionModal
        open={aiConfirmOpen}
        title={tenant.ai_enabled ? "Hide AI features" : "Enable AI features"}
        message={
          tenant.ai_enabled
            ? `Hide AI features from ${tenant.name}? Their users will lose access to AI-assisted listing tools immediately.`
            : `Enable AI features for ${tenant.name}? Their users will be able to use AI-assisted listing tools immediately.`
        }
        confirmLabel={tenant.ai_enabled ? "Hide AI" : "Enable AI"}
        confirmingLabel="Saving…"
        tone={tenant.ai_enabled ? "warning" : "success"}
        loading={togglingAi}
        onConfirm={handleConfirmToggleAi}
        onClose={() => setAiConfirmOpen(false)}
      />
      <ConfirmActionModal
        open={impersonateConfirmOpen}
        title="Impersonate tenant admin"
        message={`Impersonate ${tenant.admin_email ?? "this tenant's admin"} for tenant "${tenant.name}"? You will be signed in as them until you exit impersonation.`}
        confirmLabel="Impersonate"
        confirmingLabel="Loading…"
        tone="warning"
        loading={impersonating}
        onConfirm={handleConfirmImpersonate}
        onClose={() => setImpersonateConfirmOpen(false)}
      />
    </>
  );
}
