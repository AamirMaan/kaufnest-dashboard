"use client";

import { useRef, useState, useReducer } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addPurchase } from "../_store/purchasesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { parseCsvText, exportToCsv } from "@/lib/utils/csv";
import { parseExcelBuffer } from "@/lib/utils/excel";
import { applyRate } from "@/lib/fx/convert";
import { fxReviewReducer, resolveRowRate } from "@/components/import/fxReviewState";
import { FxRateReview, type FxRateReviewRow } from "@/components/import/FxRateReview";
import {
  resolveHeaders,
  canonicalizeRow,
  validatePurchaseRow,
  PURCHASE_IMPORT_COLUMNS,
  TEMPLATE_HEADERS,
  TEMPLATE_EXAMPLE,
  type ParsedPurchaseRow,
} from "./purchaseImportFormats";
import type { Purchase } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
}

export function ImportPurchasesModal({ open, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const baseCurrency = useAppSelector((s) => s.companyProfile.profile?.currency) ?? "EUR";
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedPurchaseRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // This modal has no format dropdown, so the file read is its only async
  // gap needing a staleness guard (mirrors ImportExpensesModal.tsx's
  // fileReadIdRef) — claimed before the read starts, re-checked after both
  // the parse AND the new /api/fx/rates round trip below, so selecting a
  // newer file while either is in flight can't land a stale result.
  const fileReadIdRef = useRef(0);
  // FX rate review — only entered when the parsed file has rows in a
  // currency other than `baseCurrency` (see the two-pass row lifecycle in
  // the currency-conversion-at-import plan's "Implementation judgment
  // calls").
  const [fxReviewOpen, setFxReviewOpen] = useState(false);
  const [fxState, fxDispatch] = useReducer(fxReviewReducer, { entries: {} });
  const [fxRows, setFxRows] = useState<FxRateReviewRow[]>([]);
  const [applyingRates, setApplyingRates] = useState(false);

  const validRows = parsed.filter((r) => r.data !== null);
  const errors = parsed.filter((r) => r.error !== null);
  const canImport = parsed.length > 0 && errors.length === 0 && validRows.length > 0;

  function reset() {
    setParsed([]);
    setFileName("");
    setImportError(null);
    setFxReviewOpen(false);
    setFxRows([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() {
    if (loading) return;
    reset();
    onClose();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportError(null);

    const fileReadId = ++fileReadIdRef.current;
    const isCurrent = () => fileReadIdRef.current === fileReadId;

    const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    const load = isExcel
      ? new Promise<{ headers: string[]; rows: Record<string, string>[] }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(parseExcelBuffer(ev.target!.result as ArrayBuffer));
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(file);
        })
      : new Promise<{ headers: string[]; rows: Record<string, string>[] }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(parseCsvText(ev.target?.result as string));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        });

    load
      .then(async ({ headers, rows }) => {
        if (!isCurrent()) return; // a newer file selection has already superseded this read
        if (rows.length === 0) {
          setParsed([{ rowNum: 0, data: null, error: "File is empty or has no data rows." }]);
          return;
        }
        // Header-alias resolution (German names, unit suffixes) — gained by
        // this task's parity refactor; the modal previously read raw CSV
        // header strings as row keys directly, so only exact English
        // column names ever worked.
        const { mapping, missingRequired } = resolveHeaders(headers, PURCHASE_IMPORT_COLUMNS);
        if (missingRequired.length > 0) {
          setParsed([{
            rowNum: 0,
            data: null,
            error: `Missing required column${missingRequired.length !== 1 ? "s" : ""}: ${missingRequired.join(", ")} — download the template or check your column names.`,
          }]);
          return;
        }
        const canonical = rows.map((row) => canonicalizeRow(row, mapping));
        const validated = canonical.map((row, i) => validatePurchaseRow(row, i + 2, "dmy", baseCurrency));
        setParsed(validated);
        await detectAndReviewFxRates(validated, isCurrent);
      })
      .catch(() => {
        if (!isCurrent()) return;
        setParsed([{ rowNum: 0, data: null, error: "Could not read the file." }]);
      });
  }

  /**
   * Groups rows carrying a `sheetCurrency` (set by `validatePurchaseRow`
   * when a row's currency differs from `baseCurrency`) and, if any exist,
   * fetches ECB rates for every (currency, date) pair and opens the FX
   * review step. Mirrors `ImportSalesModal.tsx`'s identical helper.
   */
  async function detectAndReviewFxRates(rows: ParsedPurchaseRow[], isCurrent: () => boolean) {
    const currencyGroups = new Map<string, { count: number; dates: string[] }>();
    for (const row of rows) {
      if (!row.sheetCurrency || row.error) continue;
      const g = currencyGroups.get(row.sheetCurrency) ?? { count: 0, dates: [] };
      g.count++;
      if (row.data?.date) g.dates.push(row.data.date);
      currencyGroups.set(row.sheetCurrency, g);
    }
    if (currencyGroups.size === 0) return;

    const rowsSummary: FxRateReviewRow[] = Array.from(currencyGroups.entries()).map(
      ([currency, g]) => {
        const sortedDates = g.dates.slice().sort();
        return {
          currency,
          rowCount: g.count,
          dateSpan: { from: sortedDates[0], to: sortedDates.at(-1)! },
        };
      },
    );
    setFxRows(rowsSummary);

    const pairs = rowsSummary.flatMap((r) =>
      Array.from(new Set(currencyGroups.get(r.currency)!.dates)).map((date) => ({
        currency: r.currency,
        date,
      })),
    );

    let rates: Record<string, { rate: number; rateDate: string }> = {};
    let unresolved: string[] = [];
    try {
      const res = await fetch("/api/fx/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base: baseCurrency, pairs }),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          rates: Record<string, { rate: number; rateDate: string }>;
          unresolved: string[];
        };
        rates = json.rates;
        unresolved = json.unresolved;
      } else {
        unresolved = pairs.map((p) => `${p.currency}:${p.date}`);
      }
    } catch {
      unresolved = pairs.map((p) => `${p.currency}:${p.date}`);
    }
    if (!isCurrent()) return; // superseded while the FX rate fetch was in flight

    fxDispatch({
      type: "init",
      currencies: rowsSummary.map((r) => r.currency),
      unresolvedCurrencies: Array.from(new Set(unresolved.map((k) => k.split(":")[0]))),
    });
    fxDispatch({ type: "ratesResolved", rates });
    setFxReviewOpen(true);
  }

  async function handleConfirmRates() {
    setApplyingRates(true);
    const updated = parsed.map((row) => {
      if (!row.sheetCurrency || !row.data) return row;
      const resolved = resolveRowRate(row.sheetCurrency, row.data.date, fxState);
      if (!resolved) return row; // shouldn't happen if isReviewComplete gated the button; defensive no-op
      return { ...row, data: applyRate(row.data, row.sheetCurrency, resolved.rate, resolved.rateDate) };
    });
    setParsed(updated);
    setFxReviewOpen(false);
    setApplyingRates(false);
  }

  function handleCancelFxReview() {
    // No safe partial state where some rows are converted and others
    // aren't — re-selecting the file re-triggers the review from scratch.
    reset();
  }

  async function handleImport() {
    if (!canImport) return;
    setLoading(true);
    setImportError(null);
    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const payload = validRows.map((r) => ({ ...r.data!, created_by: user.id }));
    const { data: inserted, error } = await supabase.from("purchases").insert(payload).select();
    if (error) {
      setImportError(error.message);
      setLoading(false);
      return;
    }

    for (const purchase of (inserted as Purchase[])) dispatch(addPurchase(purchase));

    const log = await writeAuditLog(supabase, {
      userId: user.id,
      userEmail: user.email ?? "",
      action: "create",
      entityType: "purchase",
      metadata: { bulk_import: true, count: inserted.length },
    });
    if (log) dispatch(addAuditLog(log));

    setLoading(false);
    reset();
    onSuccess(inserted.length);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import Purchases"
      footer={
        fxReviewOpen ? undefined : (
          <>
            <Button variant="secondary" onClick={handleClose} disabled={loading}>Cancel</Button>
            <Button onClick={handleImport} disabled={!canImport || loading}>
              {loading ? "Importing…" : canImport ? `Import ${validRows.length} row${validRows.length !== 1 ? "s" : ""}` : "Import"}
            </Button>
          </>
        )
      }
    >
      {fxReviewOpen ? (
        <FxRateReview
          rows={fxRows}
          state={fxState}
          dispatch={fxDispatch}
          onCancel={handleCancelFxReview}
          onConfirm={handleConfirmRates}
          confirming={applyingRates}
        />
      ) : (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--color-text-muted)]">
            Required: <code className="text-xs bg-[var(--color-surface-raised)] px-1 rounded">date, product_name, quantity, unit_price</code>
            <span className="block text-xs mt-1">
              Optional: <code className="text-xs bg-[var(--color-surface-raised)] px-1 rounded">vendor, currency, vat_rate, description</code>
            </span>
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => exportToCsv("purchases-import-template", TEMPLATE_HEADERS, [TEMPLATE_EXAMPLE])}
          >
            Template
          </Button>
        </div>

        <div
          className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-border)] p-6 cursor-pointer hover:border-[var(--color-primary)] transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <span className="text-sm text-[var(--color-text-muted)]">
            {fileName || "Click to select a CSV or Excel file"}
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">.csv · .xlsx · .xls</span>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={handleFile} />
        </div>

        {parsed.length > 0 && (
          <div className="space-y-2">
            {validRows.length > 0 && errors.length === 0 && (
              <p className="text-sm text-[var(--color-success)]">
                ✓ {validRows.length} row{validRows.length !== 1 ? "s" : ""} ready to import
              </p>
            )}
            {errors.length > 0 && (
              <>
                <p className="text-sm text-[var(--color-danger)]">
                  {errors.length} row{errors.length !== 1 ? "s" : ""} have errors — fix the file and re-upload:
                </p>
                <div className="rounded-[var(--radius-card)] border border-[var(--color-danger)] p-3 space-y-1 max-h-40 overflow-y-auto">
                  {errors.slice(0, 20).map((e) => (
                    <p key={e.rowNum} className="text-xs text-[var(--color-danger)]">{e.error}</p>
                  ))}
                  {errors.length > 20 && (
                    <p className="text-xs text-[var(--color-danger)]">…and {errors.length - 20} more</p>
                  )}
                </div>
              </>
            )}
            {importError && (
              <p className="text-sm text-[var(--color-danger)]">Import failed: {importError}</p>
            )}
          </div>
        )}
      </div>
      )}
    </Modal>
  );
}
