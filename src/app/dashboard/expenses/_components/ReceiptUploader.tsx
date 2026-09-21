"use client";

import { useEffect, useState } from "react";
import { ImageIcon, Loader2, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { EXPENSE_RECEIPTS_BUCKET, buildReceiptPath, pathFromStoredReceipt } from "../_lib/receiptPath";
import type { ExpenseReceipt } from "@/types";

const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;
const MAX_RECEIPT_MB = Math.round(MAX_RECEIPT_BYTES / (1024 * 1024));

interface Props {
  receipts: ExpenseReceipt[];
  setReceipts: (receipts: ExpenseReceipt[]) => void;
  expenseId: string | null;
  onExpenseCreated: () => Promise<string>;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

export function ReceiptUploader({
  receipts,
  setReceipts,
  expenseId,
  onExpenseCreated,
  onBusyChange,
  disabled,
}: Props) {
  const { success, error: toastError } = useToast();
  const [uploading, setUploading] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  function setUploadingState(next: boolean) {
    setUploading(next);
    onBusyChange?.(next);
  }

  // Private bucket — thumbnails need a signed URL, refetched whenever the
  // receipt list changes. Deliberately short-lived (60s, per the design
  // doc's section 2) — a thumbnail left open past that window just stops
  // rendering, it never serves a stale/wrong file.
  useEffect(() => {
    let cancelled = false;
    if (receipts.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSignedUrls({});
      return;
    }
    (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const tenantSchema = session?.user.app_metadata?.tenant_schema as string | undefined;
      if (!tenantSchema) return;

      // Defence in depth, mirroring the same check `removeReceipt` already
      // applies before a delete — a receipt whose path doesn't belong to
      // this tenant is never handed to Storage, signed-URL fetch included.
      const paths = receipts
        .map((r) => pathFromStoredReceipt(r, tenantSchema))
        .filter((p): p is string => p !== null);
      if (paths.length === 0) return;

      const { data } = await supabase.storage
        .from(EXPENSE_RECEIPTS_BUCKET)
        .createSignedUrls(paths, 60);
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      for (const entry of data) {
        if (entry.signedUrl && entry.path) next[entry.path] = entry.signedUrl;
      }
      setSignedUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [receipts]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const picked = Array.from(files);
    const failures: string[] = [];

    // One bad file must never abort the rest of the batch.
    const valid = picked.filter((file) => {
      if (!file.type.startsWith("image/")) {
        failures.push(`${file.name}: only image files can be attached as receipts.`);
        return false;
      }
      if (file.size > MAX_RECEIPT_BYTES) {
        failures.push(`${file.name}: larger than ${MAX_RECEIPT_MB} MB.`);
        return false;
      }
      return true;
    });

    if (valid.length === 0) {
      setErrors(failures);
      if (failures.length > 0) toastError("Receipt not attached", failures[0]);
      return;
    }

    setUploadingState(true);
    setErrors([...failures]);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const tenantSchema = session?.user.app_metadata?.tenant_schema as string | undefined;
      if (!tenantSchema) {
        const msg = "Your workspace could not be identified. Sign out and back in.";
        setErrors([...failures, msg]);
        toastError("Receipt upload failed", msg);
        return;
      }

      // Lazy row creation: a receipt attached before the rest of the form is
      // submitted needs a real expense id to upload under.
      let targetId = expenseId;
      if (!targetId) {
        try {
          targetId = await onExpenseCreated();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Could not save the expense yet.";
          setErrors([...failures, msg]);
          toastError("Receipt not attached", msg);
          return;
        }
      }

      const uploaded: ExpenseReceipt[] = [];
      for (const file of valid) {
        try {
          const path = buildReceiptPath(tenantSchema, targetId, file.name);
          const { error: uploadError } = await supabase.storage
            .from(EXPENSE_RECEIPTS_BUCKET)
            .upload(path, file, { contentType: file.type });
          if (uploadError) throw uploadError;

          uploaded.push({
            path,
            name: file.name,
            mime: file.type,
            size: file.size,
            uploaded_at: new Date().toISOString(),
          });
        } catch (err) {
          failures.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`);
        }
      }

      if (uploaded.length > 0) {
        setReceipts([...receipts, ...uploaded]);
      }
      setErrors([...failures]);

      // No silent partial success — always one toast naming the outcome.
      if (failures.length === 0) {
        success(
          "Receipt attached",
          `${uploaded.length} file${uploaded.length !== 1 ? "s" : ""} uploaded. Save to keep ${uploaded.length !== 1 ? "them" : "it"}.`
        );
      } else if (uploaded.length > 0) {
        toastError(
          "Some receipts failed",
          `${uploaded.length} uploaded, ${failures.length} failed to upload — see the list below.`
        );
      } else {
        toastError("Receipt upload failed", failures[0]);
      }
    } finally {
      setUploadingState(false);
    }
  }

  async function removeReceipt(receipt: ExpenseReceipt) {
    // Optimistic — the tile is gone immediately; a failed Storage cleanup
    // must never block the user (same rule ImageGrid follows).
    setReceipts(receipts.filter((r) => r.path !== receipt.path));

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const tenantSchema = session?.user.app_metadata?.tenant_schema as string | undefined;
    const path = tenantSchema ? pathFromStoredReceipt(receipt, tenantSchema) : null;
    if (!path) return;

    setCleaningUp((n) => n + 1);
    try {
      const { error } = await supabase.storage.from(EXPENSE_RECEIPTS_BUCKET).remove([path]);
      if (error) console.warn("Failed to delete expense receipt", path, error);
    } finally {
      setCleaningUp((n) => n - 1);
    }
  }

  return (
    <div className="space-y-3">
      <label
        className={`flex flex-col items-center justify-center gap-1.5 rounded-(--radius-card) border-2 border-dashed border-(--color-border) p-5 text-center transition-colors ${
          uploading || disabled
            ? "opacity-60 cursor-not-allowed"
            : "cursor-pointer hover:border-(--color-primary)"
        }`}
      >
        {uploading ? (
          <Loader2 size={18} className="animate-spin text-(--color-text-faint)" />
        ) : (
          <Upload size={18} className="text-(--color-text-faint)" />
        )}
        <span className="text-sm text-(--color-text-muted)">
          {uploading ? "Uploading…" : "Click to attach a receipt"}
        </span>
        <span className="text-xs text-(--color-text-faint)">
          Images only · up to {MAX_RECEIPT_MB} MB each
        </span>
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          disabled={uploading || disabled}
          onChange={(e) => {
            handleFiles(e.target.files);
            // Let the same file be re-picked after a failure.
            e.target.value = "";
          }}
        />
      </label>

      {errors.length > 0 && (
        <ul className="space-y-1 text-sm text-(--color-danger-text)">
          {errors.map((message, i) => (
            <li key={`${i}-${message}`}>{message}</li>
          ))}
        </ul>
      )}

      {cleaningUp > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-(--color-text-faint)">
          <Loader2 size={12} className="animate-spin" />
          Removing receipt…
        </p>
      )}

      {receipts.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {receipts.map((receipt) => (
            <div
              key={receipt.path}
              className="relative rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-1"
            >
              {signedUrls[receipt.path] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={signedUrls[receipt.path]}
                  alt={receipt.name}
                  className="aspect-square w-full rounded object-cover"
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded bg-(--color-surface-subtle)">
                  <ImageIcon size={18} className="text-(--color-text-faint)" />
                </div>
              )}
              <button
                type="button"
                onClick={() => removeReceipt(receipt)}
                disabled={uploading}
                aria-label={`Remove receipt ${receipt.name}`}
                className="absolute -top-1.5 -right-1.5 rounded-full bg-(--color-danger-text) text-white p-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
