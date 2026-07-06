"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { EditTenantModal } from "./EditTenantModal";
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string; detail?: string };
      if (res.ok) {
        success("Tenant deleted", `${tenant.name} and all its data have been permanently deleted.`);
        onRefresh();
      } else {
        toastError("Delete failed", data.detail ?? data.error ?? "Could not delete tenant.");
      }
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleImpersonate() {
    const email = window.prompt(
      `Enter the super_admin email address for tenant "${tenant.name}":`
    );
    if (!email) return;

    setLoading(true);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id, adminEmail: email }),
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
        {tenant.status === "invited" && (
          <Button variant="secondary" onClick={handleResendInvite} disabled={resending}>
            {resending ? "Sending…" : "Resend Invite"}
          </Button>
        )}
        <Button variant="secondary" onClick={handleImpersonate} disabled={loading}>
          {loading ? "Loading…" : "Impersonate"}
        </Button>
        {confirmDelete ? (
          <>
            <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Yes, delete"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
      </div>

      <EditTenantModal
        open={editOpen}
        tenant={tenant}
        onClose={() => {
          setEditOpen(false);
          onRefresh();
        }}
      />
    </>
  );
}
