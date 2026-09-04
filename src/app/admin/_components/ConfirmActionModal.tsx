"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export type ConfirmTone = "warning" | "success" | "info";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmingLabel: string;
  tone: ConfirmTone;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

const TONE_CLASSES: Record<ConfirmTone, string> = {
  warning: "border-[var(--color-warning-text)]/30 bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]",
  success: "border-[var(--color-success-text)]/30 bg-[var(--color-success-bg)] text-[var(--color-success-text)]",
  info:    "border-[var(--color-info-text)]/30 bg-[var(--color-info-bg)] text-[var(--color-info-text)]",
};

export function ConfirmActionModal({
  open,
  title,
  message,
  confirmLabel,
  confirmingLabel,
  tone,
  loading,
  onConfirm,
  onClose,
}: Props) {
  function handleClose() {
    if (loading) return;
    onClose();
  }

  return (
    <Modal
      title={title}
      open={open}
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={loading}>
            {loading ? confirmingLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <div className={`rounded-lg border px-4 py-3 text-sm ${TONE_CLASSES[tone]}`}>
        {message}
      </div>
    </Modal>
  );
}
