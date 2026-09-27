"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { parseReceipt } from "../_lib/parseReceipt";
import {
  applyReceiptToForm,
  type ReceiptField,
  type ReceiptFillBaseline,
  type ReceiptFillableForm,
} from "../_lib/applyReceiptToForm";
import { EXPENSE_RECEIPTS_BUCKET, pathFromStoredReceipt } from "../_lib/receiptPath";
import type { ExpenseReceipt } from "@/types";

/** Token-based ring on a field the receipt filled, until the user edits it. */
const AUTOFILL_HIGHLIGHT = "ring-2 ring-(--color-primary)/40";

async function downloadReceipt(receipt: ExpenseReceipt): Promise<Blob> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const tenantSchema = session?.user.app_metadata?.tenant_schema as string | undefined;
  const path = tenantSchema ? pathFromStoredReceipt(receipt, tenantSchema) : null;
  if (!path) throw new Error("receipt_not_in_tenant");
  const { data, error } = await supabase.storage.from(EXPENSE_RECEIPTS_BUCKET).download(path);
  if (error || !data) throw new Error("receipt_download_failed");
  return data;
}

/**
 * "Fill from receipt": download the stored receipt, read it in the browser
 * (no AI, no server), parse it and merge it into the form without
 * overwriting anything typed. Shared by the Add and Edit expense modals.
 */
export function useReceiptAutofill<F extends ReceiptFillableForm>(
  form: F,
  setForm: Dispatch<SetStateAction<F>>,
  baseline: ReceiptFillBaseline
) {
  const { success, info, error: toastError } = useToast();
  const [fillingPath, setFillingPath] = useState<string | null>(null);
  const [filledFields, setFilledFields] = useState<ReadonlySet<string>>(new Set());

  // Reading takes seconds (OCR); merge into the form as it is when reading
  // finishes, so anything typed meanwhile is respected, not the snapshot
  // from when the button was clicked.
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  });

  // Bumped by `reset()` (close/cancel/after save) and on unmount, so an
  // in-flight read that resolves afterward recognizes it's stale and makes
  // no state writes/toast — the Add modal never unmounts (`page.tsx` only
  // toggles `open`), so an abandoned read would otherwise land its result
  // on the next "Add Expense" session.
  const generation = useRef(0);
  useEffect(() => {
    return () => {
      generation.current += 1;
    };
  }, []);

  async function fillFromReceipt(receipt: ExpenseReceipt) {
    const myGeneration = generation.current;
    setFillingPath(receipt.path);
    try {
      const blob = await downloadReceipt(receipt);
      const { extractReceiptText } = await import("../_lib/extractReceiptText");
      const { text } = await extractReceiptText(blob, receipt.mime);
      const parsed = parseReceipt(text);
      const { form: next, filled } = applyReceiptToForm(formRef.current, parsed, baseline);

      if (generation.current !== myGeneration) return;

      if (filled.length > 0) {
        setForm(next);
        setFilledFields(new Set(filled));
        success(
          `Filled ${filled.length} field${filled.length !== 1 ? "s" : ""} from receipt`,
          "Check the highlighted fields before saving."
        );
      } else if (Object.keys(parsed).length > 0) {
        info("Nothing to fill", "Every field this receipt covers already has a value.");
      } else {
        toastError("Couldn't read any details from this receipt", "Fill the fields in manually.");
      }
    } catch {
      if (generation.current !== myGeneration) return;
      toastError("Couldn't read this receipt", "Try a clearer photo, or fill the fields in manually.");
    } finally {
      if (generation.current === myGeneration) setFillingPath(null);
    }
  }

  function clearHighlight(field: string) {
    setFilledFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }

  /** Clears highlights and abandons any in-flight read — call on close/cancel/after save. */
  function reset() {
    generation.current += 1;
    setFillingPath(null);
    setFilledFields(new Set());
  }

  return {
    fillingPath,
    fillFromReceipt,
    highlight: (field: ReceiptField) => (filledFields.has(field) ? AUTOFILL_HIGHLIGHT : undefined),
    clearHighlight,
    reset,
  };
}
