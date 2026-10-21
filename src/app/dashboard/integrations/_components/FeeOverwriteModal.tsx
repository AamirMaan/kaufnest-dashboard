"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { integrationErrorMessage } from "@/lib/utils/integrationErrors";
import type { Currency } from "@/types";
import {
  addApplyCounts, applyPayload, applySummary, batchRows, groupOverwriteRows, previewSkipNote,
  type ApplyCounts, type FeeCell, type FeeOverwritePreviewDto, type OverwriteRow,
} from "../_lib/feeOverwriteSelection";

interface FeeOverwriteModalProps {
  open: boolean;
  connectionId: string;
  accountName: string;
  onClose: () => void;
}

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: FeeOverwritePreviewDto };

/** current → eBay for a changed fee; "—" for a fee that isn't changing. */
function Cell({ cell, currency }: { cell?: FeeCell; currency: string }) {
  if (!cell) return <span className="text-[var(--color-text-faint)]">—</span>;
  const fmt = (n: number | null) => (n === null ? "—" : formatCurrency(n, currency as Currency));
  return (
    <span className="whitespace-nowrap">
      <span className="text-[var(--color-text-muted)] line-through">{fmt(cell.from)}</span>
      {" → "}
      <span className="font-semibold text-[var(--color-text-strong)]">{fmt(cell.to)}</span>
    </span>
  );
}

export function FeeOverwriteModal({ open, connectionId, accountName, onClose }: FeeOverwriteModalProps) {
  const { success, error: toastError } = useToast();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/integrations/ebay/fees/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectionId }),
        });
        const json = (await res.json().catch(() => ({}))) as FeeOverwritePreviewDto & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setLoad({ status: "error", message: integrationErrorMessage(json.error, json.error ?? "Please try again.") });
          return;
        }
        setLoad({ status: "ready", preview: json });
        setSelected(new Set(json.changes.map((c) => c.saleId)));
      } catch {
        if (!cancelled) setLoad({ status: "error", message: "Couldn't load fees from eBay. Please try again." });
      }
    })();
    return () => { cancelled = true; };
  }, [open, connectionId]);

  const rows = useMemo(() => (load.status === "ready" ? groupOverwriteRows(load.preview.changes) : []), [load]);

  async function handleApply() {
    setApplying(true);
    let totals: ApplyCounts = { applied: 0, stale: 0, failed: 0 };
    let failure: string | null = null;
    try {
      // The route caps changes per request; send the ticked rows in batches, in turn.
      for (const batch of batchRows(rows.filter((r) => selected.has(r.saleId)))) {
        const res = await fetch("/api/integrations/ebay/fees/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(applyPayload(connectionId, batch, selected)),
        });
        const json = (await res.json().catch(() => ({}))) as Partial<ApplyCounts> & { error?: string };
        totals = addApplyCounts(totals, json);
        if (!res.ok) {
          failure = integrationErrorMessage(json.error, json.error ?? "Please try again.");
          break;
        }
      }
    } catch {
      failure = "Please try again.";
    } finally {
      setApplying(false);
    }
    if (failure === null) {
      success("Fees updated from eBay", applySummary(totals));
      onClose();
    } else if (totals.applied > 0) {
      // Some fees were written: the preview is out of date, so a retry from it would
      // misreport them as changed. Close; reopening fetches what's left.
      toastError("Some fees couldn't be updated", `${applySummary(totals)} ${failure} Reopen to review what's left.`);
      onClose();
    } else {
      // Nothing written: keep the modal and selection so the user can retry.
      toastError("Couldn't update fees", failure);
    }
  }

  const hasChanges = load.status === "ready" && rows.length > 0;
  const skipNote = load.status === "ready" ? previewSkipNote(load.preview) : null;
  const footer = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={applying}>
        {hasChanges ? "Cancel" : "Close"}
      </Button>
      {hasChanges && (
        <Button onClick={handleApply} disabled={applying || selected.size === 0}>
          {applying ? "Applying…" : `Apply ${selected.size} ${selected.size === 1 ? "order line" : "order lines"}`}
        </Button>
      )}
    </>
  );

  return (
    // Escape/backdrop can't dismiss the modal while a bulk write is in flight.
    <Modal title={`Overwrite fees from eBay — ${accountName}`} open={open} onClose={applying ? () => {} : onClose} footer={footer}>
      {load.status === "loading" && (
        <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <Loader2 size={16} className="animate-spin" /> Checking eBay…
        </p>
      )}
      {load.status === "error" && <p className="text-sm text-[var(--color-danger-text)]">{load.message}</p>}
      {load.status === "ready" && (
        <div className="space-y-4">
          {rows.length > 0 && (
            <p className="text-sm">
              These order lines&apos; fees differ from eBay (last 90 days). Ticked lines get eBay&apos;s values; untick any
              you want to keep.
            </p>
          )}
          <DataTable<OverwriteRow>
            rows={rows}
            keyField="saleId"
            selectedIds={selected}
            onSelectionChange={setSelected}
            emptyMessage="All fees already match eBay."
            columns={[
              { header: "Order", accessor: "externalOrderId" },
              { header: "Date", render: (r) => formatDate(r.date), sortValue: (r) => r.date },
              { header: "Platform Fee", render: (r) => <Cell cell={r.platform_fee} currency={r.currency} /> },
              { header: "Ad Fee", render: (r) => <Cell cell={r.advertising_fee} currency={r.currency} /> },
            ]}
          />
          {skipNote && <p className="text-xs text-[var(--color-text-muted)]">{skipNote}</p>}
        </div>
      )}
    </Modal>
  );
}
