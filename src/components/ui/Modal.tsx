"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Optional footer (action buttons). If omitted the modal has no footer bar. */
  footer?: React.ReactNode;
}

export function Modal({ title, open, onClose, children, footer }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Trap scroll
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative z-10 w-full max-w-lg rounded-[var(--radius-card)] bg-[var(--color-surface)] shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 sm:px-6 border-b border-[var(--color-border)]">
          <h2
            id="modal-title"
            className="text-base font-semibold text-[var(--color-text-strong)]"
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--color-text-faint)] hover:text-[var(--color-text-base)] transition-colors rounded-md p-1 -mr-1"
            aria-label="Close"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 px-4 sm:px-6 py-4 border-t border-[var(--color-border)]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
