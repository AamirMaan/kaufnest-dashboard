"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { EditTenantModal } from "./EditTenantModal";
import { DeleteTenantModal } from "./DeleteTenantModal";
import type { Tenant } from "@/types";

interface Props {
  tenant: Tenant;
  onRefresh: () => void;
}

export function TenantActions({ tenant, onRefresh }: Props) {
  const { success, error: toastError } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [togglingAi, setTogglingAi] = useState(false);

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

  async function handleToggleAi() {
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
        onRefresh();
      } else {
        toastError("Could not update AI visibility", data.error ?? "Please try again.");
      }
    } finally {
      setTogglingAi(false);
    }
  }

  async function handleImpersonate() {
    if (
      !window.confirm(
        `Impersonate ${tenant.admin_email ?? "this tenant's admin"} for tenant "${tenant.name}"?`
      )
    ) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id }),
      });

      const data = (await res.json()) as { ok?: boolean; magicLink?: string; error?: string };

      if (!res.ok || !data.magicLink) {
        alert(data.error ?? "Impersonation failed");
        return;
      }

      window.location.href = data.magicLink;
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => setEditOpen(true)}>
          Edit
        </Button>
        <Button variant="secondary" onClick={handleToggleAi} disabled={togglingAi}>
          {togglingAi ? "Saving…" : tenant.ai_enabled ? "AI: On" : "AI: Off"}
        </Button>
        {tenant.status === "invited" && (
          <Button variant="secondary" onClick={handleResendInvite} disabled={resending}>
            {resending ? "Sending…" : "Resend Invite"}
          </Button>
        )}
        <Button variant="secondary" onClick={handleImpersonate} disabled={loading}>
          {loading ? "Loading…" : "Impersonate"}
        </Button>
        <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
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
    </>
  );
}
