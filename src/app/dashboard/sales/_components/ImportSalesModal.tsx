"use client";

import { useRef, useState } from "react";
import { useAppDispatch } from "@/store/hooks";
import { addSale } from "../_store/salesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { vatAmountFromGross } from "@/lib/utils/currency";
import { parseCsvText, exportToCsv } from "@/lib/utils/csv";
import type { Sale, Platform, Currency } from "@/types";

const VALID_PLATFORMS: Platform[] = ["amazon", "ebay", "etsy", "shopify", "other"];
const VALID_CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

const TEMPLATE_HEADERS = ["date", "product_name", "platform", "quantity", "unit_price", "currency", "vat_rate", "status", "description"];
const TEMPLATE_EXAMPLE = ["2024-01-15", "Blue Widget", "amazon", "10", "9.99", "EUR", "19", "pending", "Sample sale"];

interface ParsedRow {
  rowNum: number;
  data: Omit<Sale, "id" | "created_by" | "created_at" | "product_id"> | null;
  error: string | null;
}

function validateRow(raw: Record<string, string>, rowNum: number): ParsedRow {
  const date = raw.date?.trim();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { rowNum, data: null, error: `Row ${rowNum}: invalid or missing "date" (expected YYYY-MM-DD)` };
  }
  const productName = raw.product_name?.trim();
  if (!productName) {
    return { rowNum, data: null, error: `Row ${rowNum}: missing "product_name"` };
  }
  const platformRaw = (raw.platform?.trim().toLowerCase() || "other") as Platform;
  if (!VALID_PLATFORMS.includes(platformRaw)) {
    return { rowNum, data: null, error: `Row ${rowNum}: invalid "platform" "${raw.platform}" — use: ${VALID_PLATFORMS.join(", ")}` };
  }
  const quantity = parseInt(raw.quantity?.trim(), 10);
  if (!quantity || quantity <= 0) {
    return { rowNum, data: null, error: `Row ${rowNum}: "quantity" must be a positive integer` };
  }
  const unitPrice = parseFloat(raw.unit_price?.trim());
  if (isNaN(unitPrice) || unitPrice <= 0) {
    return { rowNum, data: null, error: `Row ${rowNum}: "unit_price" must be a positive number` };
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
  const totalAmount = quantity * unitPrice;
  const vatAmount = vatRate ? vatAmountFromGross(totalAmount, vatRate) : null;
  const status = raw.status?.trim() || "pending";
  return {
    rowNum,
    data: {
      platform: platformRaw,
      product_name: productName,
      quantity,
      unit_price: unitPrice,
      total_amount: totalAmount,
      currency: currencyRaw,
      date,
      description: raw.description?.trim() || null,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      status,
      restock: false,
      external_order_id: null,
    },
    error: null,
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
}

export function ImportSalesModal({ open, onClose, onSuccess }: Props) {
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
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { rows } = parseCsvText(text);
      if (rows.length === 0) {
        setParsed([{ rowNum: 0, data: null, error: "File is empty or has no data rows." }]);
        return;
      }
      setParsed(rows.map((row, i) => validateRow(row, i + 2)));
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!canImport) return;
    setLoading(true);
    setImportError(null);
    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const payload = validRows.map((r) => ({ ...r.data!, created_by: user.id }));
    const { data: inserted, error } = await supabase.from("sales").insert(payload).select();
    if (error) {
      setImportError(error.message);
      setLoading(false);
      return;
    }

    for (const sale of (inserted as Sale[])) dispatch(addSale(sale));

    const log = await writeAuditLog(supabase, {
      userId: user.id,
      userEmail: user.email ?? "",
      action: "create",
      entityType: "sale",
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
      title="Import Orders"
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
            Required columns: <code className="text-xs bg-[var(--color-surface-raised)] px-1 rounded">date, product_name, platform, quantity, unit_price</code>
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => exportToCsv("sales-import-template", TEMPLATE_HEADERS, [TEMPLATE_EXAMPLE])}
          >
            Template
          </Button>
        </div>

        <div
          className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-border)] p-6 cursor-pointer hover:border-[var(--color-primary)] transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <span className="text-sm text-[var(--color-text-muted)]">
            {fileName || "Click to select a CSV file"}
          </span>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
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
