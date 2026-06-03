"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/FormFields";

interface Props {
  open: boolean;
  title: string;
  description: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

export function DeleteConfirmModal({ open, title, description, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!reason.trim()) return setError("Reason for deletion is required.");
    setError(null);
    setDeleting(true);
    await onConfirm(reason.trim());
    setReason("");
    setDeleting(false);
  }

  function handleClose() {
    setReason("");
    setError(null);
    onClose();
  }

  return (
    <Modal
      title={title}
      open={open}
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" type="button" onClick={handleConfirm} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
          {description}
        </div>

        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-warning-bg)] border border-orange-200 px-4 py-3 text-sm text-[var(--color-warning-text)]">
            {error}
          </div>
        )}

        <Field label="Reason for Deletion" required>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Briefly explain why this record is being deleted…"
          />
        </Field>
      </div>
    </Modal>
  );
}
