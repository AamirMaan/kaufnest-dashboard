"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import type { Tenant } from "@/types";

interface Props {
  open: boolean;
  tenant: Tenant;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteTenantModal({ open, tenant, onClose, onDeleted }: Props) {
  const { success, error: toastError } = useToast();
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  const confirmed = confirmation === tenant.schema_name;

  async function handleDelete() {
    if (!confirmed) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string; detail?: string };
      if (res.ok) {
        success("Tenant deleted", `${tenant.name} and all its data have been permanently deleted.`);
        onDeleted();
      } else {
        toastError("Delete failed", data.detail ?? data.error ?? "Could not delete tenant.");
      }
    } finally {
      setDeleting(false);
    }
  }

  function handleClose() {
    if (deleting) return;
    setConfirmation("");
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Delete Tenant">
      <div className="space-y-4">
        <div className="rounded-lg border border-[var(--color-danger-text)]/30 bg-[var(--color-danger-bg)] px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-[var(--color-danger-text)]">
            This action is permanent and cannot be undone.
          </p>
          <p className="text-sm text-[var(--color-danger-text)]/80">
            Deleting <strong>{tenant.name}</strong> will permanently destroy the
            tenant schema, all stored data, and all associated user accounts.
          </p>
        </div>

        <Field label={`Type the schema name to confirm: ${tenant.schema_name}`}>
          <Input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={tenant.schema_name}
            disabled={deleting}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={handleClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={!confirmed || deleting}>
            {deleting ? "Deleting…" : "Delete tenant"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
