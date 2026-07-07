"use client";

import { useRef, useState } from "react";
import { useAppDispatch } from "@/store/hooks";
import { addExpense } from "../_store/expensesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { vatAmountFromGross } from "@/lib/utils/currency";
import { parseCsvText, exportToCsv } from "@/lib/utils/csv";
import { parseExcelBuffer } from "@/lib/utils/excel";
import type { Expense, ExpenseCategory, Currency } from "@/types";

const VALID_CATEGORIES: ExpenseCategory[] = [
  "shipping", "advertising", "software", "office", "inventory", "tax", "salary", "other",
];
const VALID_CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

const TEMPLATE_HEADERS = ["date", "title", "category", "vendor", "amount", "currency", "vat_rate", "description", "invoice_number", "vendor_vat_number"];
const TEMPLATE_EXAMPLE = ["2024-01-15", "Office Supplies", "office", "Staples", "49.99", "EUR", "19", "Monthly supplies", "RE-2024-001", "DE123456789"];

interface ParsedRow {
  rowNum: number;
  data: Omit<Expense, "id" | "created_by" | "created_at"> | null;
  error: string | null;
}

function validateRow(raw: Record<string, string>, rowNum: number): ParsedRow {
  const date = raw.date?.trim();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { rowNum, data: null, error: `Row ${rowNum}: invalid or missing "date" (expected YYYY-MM-DD)` };
  }
  const title = raw.title?.trim();
  if (!title) {
    return { rowNum, data: null, error: `Row ${rowNum}: missing "title"` };
  }
  const amount = parseFloat(raw.amount?.trim());
  if (isNaN(amount) || amount <= 0) {
    return { rowNum, data: null, error: `Row ${rowNum}: "amount" must be a positive number` };
  }
  const categoryRaw = (raw.category?.trim().toLowerCase() || "other") as ExpenseCategory;
  if (!VALID_CATEGORIES.includes(categoryRaw)) {
    return { rowNum, data: null, error: `Row ${rowNum}: invalid "category" "${raw.category}" — use: ${VALID_CATEGORIES.join(", ")}` };
  }
  const currencyRaw = (raw.currency?.trim().toUpperCase() || "EUR") as Currency;
  if (!VALID_CURRENCIES.includes(currencyRaw)) {
    return { rowNum, data: null, error: `Row ${rowNum}: invalid "currency" "${raw.currency}" — use: EUR, USD, GBP` };
  }
  const vatRateRaw = raw.vat_rate?.trim();
  const vatRate = vatRateRaw ? parseFloat(vatRateRaw) : null;
  if (vatRate !== null && (isNaN(vatRate) || vatRate < 0 || vatRate > 100)) {
    return { rowNum, data: null, error: `Row ${rowNum}: "vat_rate" must be between 0 and 100` };
  }
  const vatAmount = vatRate ? vatAmountFromGross(amount, vatRate) : null;
  return {
    rowNum,
    data: {
      title,
      amount,
      currency: currencyRaw,
      category: categoryRaw,
      vendor: raw.vendor?.trim() || null,
      date,
      description: raw.description?.trim() || null,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      vendor_vat_number: raw.vendor_vat_number?.trim() || null,
      invoice_number: raw.invoice_number?.trim() || null,
    },
    error: null,
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
}

export function ImportExpensesModal({ open, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
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
      ? new Promise<{ rows: Record<string, string>[] }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(parseExcelBuffer(ev.target!.result as ArrayBuffer));
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(file);
        })
      : new Promise<{ rows: Record<string, string>[] }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(parseCsvText(ev.target?.result as string));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        });

    load
      .then(({ rows }) => {
        if (rows.length === 0) {
          setParsed([{ rowNum: 0, data: null, error: "File is empty or has no data rows." }]);
          return;
        }
        setParsed(rows.map((row, i) => validateRow(row, i + 2)));
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
    const { data: inserted, error } = await supabase.from("expenses").insert(payload).select();
    if (error) {
      setImportError(error.message);
      setLoading(false);
      return;
    }

    for (const expense of (inserted as Expense[])) dispatch(addExpense(expense));

    const log = await writeAuditLog(supabase, {
      userId: user.id,
      userEmail: user.email ?? "",
      action: "create",
      entityType: "expense",
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
      title="Import Expenses"
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
            Required: <code className="text-xs bg-[var(--color-surface-raised)] px-1 rounded">date, title, amount</code>
            <span className="block text-xs mt-1">
              Optional: <code className="text-xs bg-[var(--color-surface-raised)] px-1 rounded">category, vendor, currency, vat_rate, description, invoice_number, vendor_vat_number</code>
            </span>
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => exportToCsv("expenses-import-template", TEMPLATE_HEADERS, [TEMPLATE_EXAMPLE])}
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
