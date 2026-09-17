"use client";

import { useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addPurchase } from "../_store/purchasesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { parseCsvText, exportToCsv } from "@/lib/utils/csv";
import { parseExcelBuffer } from "@/lib/utils/excel";
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

  const validRows = parsed.filter((r) => r.data !== null);
  const errors = parsed.filter((r) => r.error !== null);
  const canImport = parsed.length > 0 && errors.length === 0 && validRows.length > 0;

  function reset() {
    setParsed([]);
    setFileName("");
    setImportError(null);
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
      .then(({ headers, rows }) => {
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
        setParsed(canonical.map((row, i) => validatePurchaseRow(row, i + 2, "dmy", baseCurrency)));
      })
      .catch(() => {
        setParsed([{ rowNum: 0, data: null, error: "Could not read the file." }]);
      });
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
        <>
          <Button variant="secondary" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleImport} disabled={!canImport || loading}>
            {loading ? "Importing…" : canImport ? `Import ${validRows.length} row${validRows.length !== 1 ? "s" : ""}` : "Import"}
          </Button>
        </>
      }
    >
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
    </Modal>
  );
}
