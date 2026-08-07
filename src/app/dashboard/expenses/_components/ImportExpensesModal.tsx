"use client";

import { useRef, useState, useMemo } from "react";
import { useAppDispatch } from "@/store/hooks";
import { addExpense } from "../_store/expensesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/FormFields";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { parseCsvText, exportToCsv } from "@/lib/utils/csv";
import { parseExcelBuffer } from "@/lib/utils/excel";
import { resolveHeaders, canonicalizeRow } from "@/lib/utils/importAliases";
import { hasOrderSensitiveDate } from "@/lib/utils/localeParse";
import {
  EXPENSE_IMPORT_FORMATS,
  EXPENSE_IMPORT_FORMAT_IDS,
  classifySkip,
  validateExpenseRow,
  type ExpenseImportFormatId,
  type ParsedExpenseRow,
} from "./expenseImportFormats";
import type { Expense } from "@/types";

type ParsedSource = { headers: string[]; rows: Record<string, string>[] };

/**
 * Read a CSV file as text. Tries UTF-8 first; if the decode produced
 * replacement characters (�), re-reads as windows-1252 — the encoding German
 * Excel typically saves CSVs in. Same helper as `ImportSalesModal`, and it is
 * load-bearing here: `categoryFor()` matches German fee descriptions
 * ("Gebühren…", "Versandkosten…") by keyword, so a mojibaked read would push
 * every row into "other".
 */
function readFileText(file: File): Promise<string> {
  const readAs = (encoding?: string) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve((ev.target?.result as string) ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, encoding);
    });
  return readAs().then((text) => (text.includes("�") ? readAs("windows-1252") : text));
}

function readFileBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target!.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function isExcelFile(name: string) {
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
}

export function ImportExpensesModal({ open, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const fileRef = useRef<HTMLInputElement>(null);
  const [formatId, setFormatId] = useState<ExpenseImportFormatId>("generic");
  // The raw `{ headers, rows }` straight off the file, kept so a format change
  // can re-derive `parsed` without asking the user to re-select the file.
  const [parsedSource, setParsedSource] = useState<ParsedSource | null>(null);
  const [parsed, setParsed] = useState<ParsedExpenseRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // True when the file contains a date whose day/month reading is genuinely
  // ambiguous (`04/09/2026`). Drives the day-first note below — this modal has
  // no date-order selector, so the assumption has to be stated rather than
  // silently applied.
  const [orderSensitiveDates, setOrderSensitiveDates] = useState(false);
  // True when the resolved header mapping has NO `category` column, which is
  // exactly when `categoryFor(title)` is deciding the category rather than the
  // user. Drives the breakdown below. Deliberately not `formatId ===
  // "vorsteuer"`: `generic` guesses too whenever the sheet omits the column,
  // and that is precisely the case the breakdown exists to make visible.
  const [categoriesAreGuessed, setCategoriesAreGuessed] = useState(false);
  // Guards against a stale parse (from a fast file/format change) overwriting a
  // newer one's result — the two results differ only in interpretation, so a
  // stale write is silent and hard to notice. Incremented on every parse and on
  // every file read; a result is applied only if its captured id is still
  // current when it resolves. Same mechanism as `ImportSalesModal`, where the
  // await is a duplicate-check query; here the await is the file read itself.
  const requestIdRef = useRef(0);

  const format = EXPENSE_IMPORT_FORMATS[formatId];
  const requiredColumns = format.columns.filter((c) => c.required).map((c) => c.key);
  const optionalColumns = format.columns.filter((c) => !c.required).map((c) => c.key);

  const validRows = parsed.filter((r) => r.data !== null);
  const errors = parsed.filter((r) => r.error !== null);
  const skipped = parsed.filter((r) => r.skipped);
  // Skips are NOT errors: a `vorsteuer` ledger is mostly blank filler, zero
  // amount padding and a trailing Total row, and erroring on those would make a
  // real quarterly export impossible to import. They carry `data: null`, so
  // they can never reach `validRows` either.
  const canImport = parsed.length > 0 && errors.length === 0 && validRows.length > 0;

  // Group skipped rows by reason so the summary can name the real reasons
  // instead of reporting an undifferentiated count. Mirrors `skipReasonCounts`
  // in `ImportSalesModal`.
  const skipReasonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of parsed) {
      if (!r.skipped) continue;
      counts.set(r.skipped, (counts.get(r.skipped) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [parsed]);

  // Shown only when the categories are GUESSED (see `categoriesAreGuessed`).
  // `categoryFor(title)` is a heuristic and this modal has no per-row preview,
  // so without this line a bad guess is only discoverable after it has landed
  // in the expenses table. Sorted by count descending — the biggest bucket is
  // the one worth checking.
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of parsed) {
      if (!r.data) continue;
      counts.set(r.data.category, (counts.get(r.data.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [parsed]);

  function reset() {
    setParsed([]);
    setParsedSource(null);
    setFileName("");
    setImportError(null);
    setOrderSensitiveDates(false);
    setCategoriesAreGuessed(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() {
    if (loading) return;
    reset();
    onClose();
  }

  /**
   * Resolve headers, canonicalise, classify and validate `source` against
   * `fmtId`. Declared async and fronted by the run-id guard so it stays
   * structurally identical to `ImportSalesModal.parseAndValidate`; the guard
   * is what lets `handleFile` discard a superseded file read.
   */
  async function parseAndValidate(source: ParsedSource, fmtId: ExpenseImportFormatId) {
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestIdRef.current === requestId;

    const fmt = EXPENSE_IMPORT_FORMATS[fmtId];
    const { headers, rows } = source;
    if (rows.length === 0) {
      setParsed([{ rowNum: 0, data: null, error: "File is empty or has no data rows." }]);
      setOrderSensitiveDates(false);
      setCategoriesAreGuessed(false);
      return;
    }

    const { mapping, missingRequired } = resolveHeaders(headers, fmt.columns);
    if (missingRequired.length > 0) {
      setParsed([{
        rowNum: 0,
        data: null,
        error: `Missing required column${missingRequired.length !== 1 ? "s" : ""}: ${missingRequired.join(", ")} — download the ${fmt.label} template or check the format dropdown.`,
      }]);
      setOrderSensitiveDates(false);
      setCategoriesAreGuessed(false);
      return;
    }

    // No resolved `category` column ⇒ `validateExpenseRow` falls through to
    // `categoryFor(title)` for every row. `vorsteuer` has no such column at all,
    // so this is always true there; `generic` only when the sheet omits it.
    setCategoriesAreGuessed(![...mapping.values()].includes("category"));

    const canonical = rows.map((row) => canonicalizeRow(row, mapping));
    setOrderSensitiveDates(hasOrderSensitiveDate(canonical.map((r) => r.date ?? "")));

    // `classifySkip` FIRST, `validateExpenseRow` only for what survives it.
    // A noise row legitimately has no date at all, so validating it first would
    // fail the whole file on `invalid or missing "date"` — the same ordering
    // bug that once broke every Amazon RETURN line in the Sales importer.
    const validated = canonical.map((row, i) => {
      const rowNum = i + 2;
      const skipReason = classifySkip(fmt, row);
      if (skipReason) {
        return { rowNum, data: null, error: null, skipped: skipReason };
      }
      return validateExpenseRow(fmt, row, rowNum);
    });

    if (!isCurrent()) return; // a newer file/format change has already superseded this run
    setParsed(validated);
  }

  function handleFormatChange(next: ExpenseImportFormatId) {
    setFormatId(next);
    setImportError(null);
    if (parsedSource !== null) {
      void parseAndValidate(parsedSource, next);
    } else {
      setParsed([]);
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportError(null);

    // The file read is this modal's async step. Selecting file A and then file
    // B before A's reader fires would otherwise let A resolve last and
    // overwrite B's result, leaving `parsedSource` and `parsed` describing
    // different files. Claim a run id now and re-check it on resolve.
    const requestId = ++requestIdRef.current;
    const loadAndParse = isExcelFile(file.name)
      ? readFileBuffer(file).then((buf) => parseExcelBuffer(buf))
      : readFileText(file).then((text) => parseCsvText(text));

    loadAndParse
      .then((source) => {
        if (requestIdRef.current !== requestId) return;
        setParsedSource(source);
        return parseAndValidate(source, formatId);
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
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
        <Field label="Import format">
          <Select
            value={formatId}
            onChange={(e) => handleFormatChange(e.target.value as ExpenseImportFormatId)}
          >
            {EXPENSE_IMPORT_FORMAT_IDS.map((id) => (
              <option key={id} value={id}>{EXPENSE_IMPORT_FORMATS[id].label}</option>
            ))}
          </Select>
        </Field>

        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-[var(--color-text-muted)]">
            Required: <code className="text-xs bg-[var(--color-surface-raised)] px-1 rounded">{requiredColumns.join(", ")}</code>
            <span className="block text-xs mt-1">
              Optional: <code className="text-xs bg-[var(--color-surface-raised)] px-1 rounded">{optionalColumns.join(", ")}</code>
            </span>
            <span className="block text-xs mt-1">
              German CSVs work too — semicolons, decimal commas (9,99), dates like 15.01.2026, and German column names.
            </span>
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              exportToCsv(
                `expenses-import-${formatId}-template`,
                format.columns.map((c) => c.key),
                // `templateExample` is ordered to match `columns`; header-only
                // when a format doesn't define one.
                format.templateExample ? [format.templateExample] : [],
              )
            }
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
            {errors.length === 0 && validRows.length > 0 && (
              <p className="text-sm text-[var(--color-success)]">
                ✓ {validRows.length} row{validRows.length !== 1 ? "s" : ""} ready to import
                {skipped.length > 0 && (
                  <span className="text-[var(--color-text-muted)]">
                    {" · "}{skipped.length} skipped
                    {" ("}
                    {skipReasonCounts.map(([reason, n]) => `${n} ${reason}`).join(", ")}
                    {")"}
                  </span>
                )}
              </p>
            )}
            {errors.length === 0 && validRows.length === 0 && skipped.length > 0 && (
              <p className="text-sm text-[var(--color-text-muted)]">
                All {skipped.length} row{skipped.length !== 1 ? "s" : ""} skipped —{" "}
                {skipReasonCounts.map(([reason, n]) => `${n} ${reason}`).join(", ")}.
              </p>
            )}
            {categoriesAreGuessed && errors.length === 0 && categoryCounts.length > 0 && (
              <p className="text-xs text-[var(--color-text-muted)]">
                Categories: {categoryCounts.map(([c, n]) => `${c} ${n}`).join(" · ")}
              </p>
            )}
            {errors.length === 0 && orderSensitiveDates && (
              <p className="text-xs text-[var(--color-text-muted)]">
                This file contains dates that could be read either way (e.g. 04/09/2026) —
                they are imported day-first (DD/MM/YYYY).
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
          </div>
        )}

        {importError && (
          <p className="text-sm text-[var(--color-danger)]">Import failed: {importError}</p>
        )}
      </div>
    </Modal>
  );
}
