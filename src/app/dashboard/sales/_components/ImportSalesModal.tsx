"use client";

import { useRef, useState, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addSale, updateSale } from "../_store/salesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/FormFields";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { parseCsvText, exportToCsv } from "@/lib/utils/csv";
import { parseExcelBuffer } from "@/lib/utils/excel";
import { detectDateOrder, type DateOrder, type DateOrderDetection } from "@/lib/utils/localeParse";
import {
  IMPORT_FORMATS,
  IMPORT_FORMAT_IDS,
  resolveHeaders,
  canonicalizeRow,
  validateRowForFormat,
  type ImportFormatId,
  type ParsedRow,
} from "./importFormats";
import type { Sale, Platform } from "@/types";

const IN_CHUNK = 200; // Supabase .in() chunk size for the duplicate pre-check

type ParsedSource = { headers: string[]; rows: Record<string, string>[] };

/**
 * Read a CSV file as text. Tries UTF-8 first; if the decode produced
 * replacement characters (�), re-reads as windows-1252 — the encoding
 * German Excel typically saves CSVs in.
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

/** Outcome summary passed to `onSuccess` — a returns-only import can insert
 * zero rows and still have done real work (matched returns, or skipped ones
 * with no matching order), so a bare inserted-count would silently hide that.
 * `returnsAlreadyApplied` counts returns that matched a sale already in
 * `status === "returned"` (typically a re-import of the same file) — these
 * are deliberately left untouched (see the stock-trigger comment in
 * `handleImport`), so surfacing them separately tells the user the re-import
 * was a no-op rather than looking like nothing happened. */
export interface ImportSummary {
  inserted: number;
  returnsMatched: number;
  returnsSkipped: number;
  returnsAlreadyApplied: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (summary: ImportSummary) => void;
}

export function ImportSalesModal({ open, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const inventoryItems = useAppSelector((s) => s.inventory.items);
  const fileRef = useRef<HTMLInputElement>(null);
  const [formatId, setFormatId] = useState<ImportFormatId>("generic");
  const [parsedSource, setParsedSource] = useState<ParsedSource | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // Amazon's report never says whether returned goods are resellable, so this
  // is a per-import choice. It applies ONLY to returns that matched an
  // existing sale — never to standalone unmatched returns.
  const [restockReturns, setRestockReturns] = useState(false);
  // null = trust detection. A non-null value is the user forcing an order,
  // which is only honoured when the file has no hard evidence to the contrary.
  const [dateOrderOverride, setDateOrderOverride] = useState<DateOrder | null>(null);
  const [dateDetection, setDateDetection] = useState<DateOrderDetection | null>(null);

  // Case-insensitive SKU → product ID lookup built from the hydrated inventory.
  const skuToProductId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of inventoryItems) {
      if (p.sku) map.set(p.sku.toLowerCase(), p.id);
    }
    return map;
  }, [inventoryItems]);

  const format = IMPORT_FORMATS[formatId];
  const requiredColumns = format.columns.filter((c) => c.required).map((c) => c.key);
  const optionalColumns = format.columns.filter((c) => !c.required).map((c) => c.key);

  const errors = parsed.filter((r) => r.error !== null);
  const skipped = parsed.filter((r) => r.skipped);
  const importable = parsed.filter((r) => r.data !== null && !r.skipped);
  const canImport = parsed.length > 0 && errors.length === 0 && importable.length > 0 && !checking;

  // Group skipped rows by reason (duplicate, blank row, summary row, not a
  // sale, unsupported currency, …) so the summary/all-skipped messages below
  // can name the real reasons instead of assuming everything is a duplicate.
  const skipReasonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of parsed) {
      if (!r.skipped) continue;
      counts.set(r.skipped, (counts.get(r.skipped) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [parsed]);

  const skuMatchCount = importable.filter(
    (r) => r.sku && skuToProductId.has(r.sku.toLowerCase()),
  ).length;

  function reset() {
    setParsed([]);
    setParsedSource(null);
    setFileName("");
    setImportError(null);
    setRestockReturns(false);
    setDateOrderOverride(null);
    setDateDetection(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() {
    if (loading) return;
    reset();
    onClose();
  }

  /**
   * Duplicate pre-check (plan decision I3): rows whose (platform,
   * external_order_id) already exists in `sales` — or appear twice in the
   * file — are marked skipped, never overwritten. Errors elsewhere still
   * block the import; skips don't.
   */
  async function markDuplicates(rows: ParsedRow[]): Promise<ParsedRow[]> {
    const seen = new Set<string>();
    const withFileDupes = rows.map((r) => {
      // RETURN rows are not new orders. They carry the external_order_id of an
      // EXISTING sale by definition, so the dedup passes would mark every one
      // "order already exists" and drop it before matching could run.
      if (r.isReturn) return r;
      if (!r.data?.external_order_id) return r;
      const key = `${r.data.platform}:${r.data.external_order_id}`;
      if (seen.has(key)) return { ...r, skipped: "duplicate in file" };
      seen.add(key);
      return r;
    });

    const byPlatform = new Map<Platform, string[]>();
    for (const r of withFileDupes) {
      if (!r.isReturn && r.data?.external_order_id && !r.skipped) {
        const list = byPlatform.get(r.data.platform) ?? [];
        list.push(r.data.external_order_id);
        byPlatform.set(r.data.platform, list);
      }
    }
    if (byPlatform.size === 0) return withFileDupes;

    setChecking(true);
    try {
      const supabase = await createTenantClient();
      const existing = new Set<string>();
      for (const [platform, ids] of byPlatform) {
        for (let i = 0; i < ids.length; i += IN_CHUNK) {
          const chunk = ids.slice(i, i + IN_CHUNK);
          const { data, error } = await supabase
            .from("sales")
            .select("external_order_id")
            .eq("platform", platform)
            .in("external_order_id", chunk);
          if (error) throw new Error(error.message);
          for (const row of data ?? []) {
            if (row.external_order_id) existing.add(`${platform}:${row.external_order_id}`);
          }
        }
      }
      return withFileDupes.map((r) => {
        // RETURN rows are not new orders. They carry the external_order_id of an
        // EXISTING sale by definition, so the dedup passes would mark every one
        // "order already exists" and drop it before matching could run.
        if (r.isReturn) return r;
        return r.data?.external_order_id && !r.skipped && existing.has(`${r.data.platform}:${r.data.external_order_id}`)
          ? { ...r, skipped: "order already exists" }
          : r;
      });
    } finally {
      setChecking(false);
    }
  }

  async function parseAndValidate(
    source: ParsedSource,
    fmtId: ImportFormatId,
    override: DateOrder | null,
  ) {
    const fmt = IMPORT_FORMATS[fmtId];
    const { headers, rows } = source;
    if (rows.length === 0) {
      setParsed([{ rowNum: 0, data: null, error: "File is empty or has no data rows." }]);
      return;
    }
    const { mapping, missingRequired } = resolveHeaders(headers, fmt);
    if (missingRequired.length > 0) {
      setParsed([{
        rowNum: 0,
        data: null,
        error: `Missing required column${missingRequired.length !== 1 ? "s" : ""}: ${missingRequired.join(", ")} — download the ${fmt.label} template or check the format dropdown.`,
      }]);
      return;
    }
    // Canonicalise first so the `date` column is resolved, then decide the
    // order from the whole file BEFORE validating any row. Guessing per-row is
    // what mis-dated 145 live orders.
    const canonical = rows.map((row) => canonicalizeRow(row, mapping));
    const detection = detectDateOrder(canonical.map((r) => r.date ?? ""));
    setDateDetection(detection);

    if (detection.conflict) {
      setParsed([{
        rowNum: 0,
        data: null,
        error: `This file mixes date formats — it contains "${detection.conflict.dayFirstSample}" (day first) and "${detection.conflict.monthFirstSample}" (month first). No single rule can read both correctly. Fix the file before importing.`,
      }]);
      return;
    }

    if (override !== null && detection.confident && override !== detection.order) {
      const proven = detection.order === "dmy" ? "day first (DD-MM-YYYY)" : "month first (MM-DD-YYYY)";
      setParsed([{
        rowNum: 0,
        data: null,
        error: `This file can only be read ${proven} — it contains a date whose other reading is not a real month. Set the date format back to Auto.`,
      }]);
      return;
    }

    const dateOrder: DateOrder = override ?? detection.order;
    const validated = canonical.map((row, i) =>
      validateRowForFormat(fmt, row, i + 2, dateOrder),
    );
    setParsed(validated); // show validation results immediately…
    try {
      setParsed(await markDuplicates(validated)); // …then refine with the dedup check
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Duplicate check failed");
    }
  }

  function handleFormatChange(next: ImportFormatId) {
    setFormatId(next);
    setImportError(null);
    if (parsedSource !== null) {
      void parseAndValidate(parsedSource, next, dateOrderOverride);
    } else {
      setParsed([]);
    }
  }

  function handleDateOrderChange(next: DateOrder | null) {
    setDateOrderOverride(next);
    setImportError(null);
    if (parsedSource !== null) {
      void parseAndValidate(parsedSource, formatId, next);
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportError(null);
    setDateOrderOverride(null);

    const loadAndParse = isExcelFile(file.name)
      ? readFileBuffer(file).then((buf) => parseExcelBuffer(buf))
      : readFileText(file).then((text) => parseCsvText(text));

    loadAndParse
      .then((source) => {
        setParsedSource(source);
        return parseAndValidate(source, formatId, null);
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

    const returnRows = importable.filter((r) => r.isReturn);
    const insertRows = importable.filter((r) => !r.isReturn);

    // Insert the non-return rows FIRST, and match/apply returns AFTER.
    // An Amazon monthly report routinely contains both the SALE and the
    // RETURN for one order (sold 3 April, returned 24 April — same
    // period, same file). If returns were matched before the insert, the
    // return's query against `sales` would run before its own SALE row
    // existed, find nothing, and be skipped as "no matching order" even
    // though the order is sitting right there in `payload`. Running the
    // insert first means a same-file return can match a row that was
    // just committed moments earlier.
    //
    // The insert is built from `insertRows` only — a return never enters
    // `payload`; returns are applied via `update`, not `insert`, below.
    const payload = insertRows.map((r) => {
      const productId = r.sku ? (skuToProductId.get(r.sku.toLowerCase()) ?? null) : null;
      return { ...r.data!, created_by: user.id, product_id: productId };
    });

    let inserted: Sale[] = [];
    if (payload.length > 0) {
      const { data, error } = await supabase.from("sales").insert(payload).select();
      if (error) {
        // Insert failed — do not run the returns loop at all. Otherwise a
        // return could be matched/applied (with real stock side effects)
        // against a batch whose sale rows never made it into the table.
        setImportError(error.message);
        setLoading(false);
        return;
      }
      inserted = data as Sale[];
      for (const sale of inserted) dispatch(addSale(sale));
    }

    // Match each return on platform + external_order_id + the product resolved
    // from SKU. Order ids are unique only within a platform (an eBay sale could
    // share an id with an unrelated Amazon one), and NOT unique within an
    // Amazon sheet — a multi-line order such as 028-6107376-1547566 appears
    // once per SKU — so platform and product must both be part of the key or
    // the wrong line gets flipped.
    //
    // Unmatched returns are SKIPPED, not inserted standalone: a non-partial
    // UNIQUE index on (platform, external_order_id) exists in every tenant
    // schema, so inserting a return whose order id already has no matching
    // line (or a second unmatched line of an already-matched multi-line
    // order) would raise a unique violation and fail the whole batch.
    const unmatchedReturns: ParsedRow[] = [];
    const alreadyAppliedReturns: ParsedRow[] = [];
    for (const r of returnRows) {
      const orderId = r.data!.external_order_id;
      const productId = r.sku ? (skuToProductId.get(r.sku.toLowerCase()) ?? null) : null;
      if (!orderId || !productId) {
        unmatchedReturns.push({ ...r, skipped: "return: no matching order" });
        continue;
      }
      const { data: match, error: matchErr } = await supabase
        .from("sales")
        .select("*")
        .eq("platform", r.data!.platform)
        .eq("external_order_id", orderId)
        .eq("product_id", productId)
        .limit(1);
      if (matchErr) {
        setImportError("Could not check existing orders for returns. Please try again.");
        setLoading(false);
        return;
      }
      const previous = match?.[0] as Sale | undefined;
      if (!previous) {
        unmatchedReturns.push({ ...r, skipped: "return: no matching order" });
        continue;
      }
      // Already applied (e.g. this file — or an overlapping one — was
      // imported before). The stock trigger (apply_sale_stock_change(),
      // 003_add_order_status.sql:53-63) computes its delta from OLD vs NEW
      // restock, so blindly re-running `update({ restock: restockReturns })`
      // here would flip an already-restocked row's delta from 0 to
      // -quantity whenever the toggle defaults back to false on re-import —
      // silently dropping stock a second time with no error. Treat it as a
      // no-op: don't update, don't touch stock, just count it separately so
      // the summary shows the re-import did nothing rather than nothing at
      // all.
      if (previous.status === "returned") {
        alreadyAppliedReturns.push({ ...r, skipped: "return already applied" });
        continue;
      }
      const { data: updated, error: updErr } = await supabase
        .from("sales")
        .update({ status: "returned", restock: restockReturns })
        .eq("id", previous.id)
        .select()
        .single<Sale>();
      if (updErr || !updated) {
        setImportError("Could not update a returned order. Please try again.");
        setLoading(false);
        return;
      }
      dispatch(updateSale(updated));

      const returnLog = await writeAuditLog(supabase, {
        userId: user.id,
        userEmail: user.email ?? "",
        action: "update",
        entityType: "sale",
        entityId: previous.id,
        metadata: {
          before: { status: previous.status, restock: previous.restock },
          after: { status: updated.status, restock: updated.restock },
          reason: "bulk import: matched return",
          bulk_import: true,
          external_order_id: orderId,
        },
      });
      if (returnLog) dispatch(addAuditLog(returnLog));
    }

    // Reflect the newly-discovered skip reasons back into `parsed` so the
    // Task 6 grouping UI shows them — matching only happens here, mid-import,
    // so `parsed` doesn't know yet.
    if (unmatchedReturns.length > 0 || alreadyAppliedReturns.length > 0) {
      const reflected = [...unmatchedReturns, ...alreadyAppliedReturns];
      setParsed((prev) =>
        prev.map((row) => reflected.find((u) => u.rowNum === row.rowNum) ?? row),
      );
    }

    const returnsMatched = returnRows.length - unmatchedReturns.length - alreadyAppliedReturns.length;

    const log = await writeAuditLog(supabase, {
      userId: user.id,
      userEmail: user.email ?? "",
      action: "create",
      entityType: "sale",
      metadata: {
        bulk_import: true,
        count: inserted.length,
        format: formatId,
        skipped: skipped.length + unmatchedReturns.length + alreadyAppliedReturns.length,
        returns_matched: returnsMatched,
        returns_unmatched: unmatchedReturns.length,
        returns_already_applied: alreadyAppliedReturns.length,
        restock_returns: restockReturns,
      },
    });
    if (log) dispatch(addAuditLog(log));

    setLoading(false);
    reset();
    onSuccess({
      inserted: inserted.length,
      returnsMatched,
      returnsSkipped: unmatchedReturns.length,
      returnsAlreadyApplied: alreadyAppliedReturns.length,
    });
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
            {loading ? "Importing…" : checking ? "Checking…" : canImport ? `Import ${importable.length} row${importable.length !== 1 ? "s" : ""}` : "Import"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Import format">
          <Select
            value={formatId}
            onChange={(e) => handleFormatChange(e.target.value as ImportFormatId)}
          >
            {IMPORT_FORMAT_IDS.map((id) => (
              <option key={id} value={id}>{IMPORT_FORMATS[id].label}</option>
            ))}
          </Select>
        </Field>

        {dateDetection && (
          <label className="flex items-center gap-2 text-sm">
            Date format
            <select
              value={dateOrderOverride ?? "auto"}
              onChange={(e) =>
                handleDateOrderChange(e.target.value === "auto" ? null : (e.target.value as DateOrder))
              }
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
            >
              <option value="auto">
                {dateDetection.conflict
                  ? "Mixed formats — cannot import"
                  : dateDetection.confident
                    ? `Auto — detected ${dateDetection.order === "dmy" ? "DD-MM-YYYY" : "MM-DD-YYYY"}`
                    : "Auto — could not tell, assuming DD-MM-YYYY"}
              </option>
              <option value="dmy">Day first (DD-MM-YYYY)</option>
              <option value="mdy">Month first (MM-DD-YYYY)</option>
            </select>
          </label>
        )}
        {dateDetection && !dateDetection.confident && !dateDetection.conflict && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Every date in this file reads the same either way, so the format could not be
            detected. Check a few dates in the preview before importing.
          </p>
        )}

        {parsed.some((r) => r.isReturn && !r.skipped) && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={restockReturns}
              onChange={(e) => setRestockReturns(e.target.checked)}
            />
            Return stock to inventory for matched returns
          </label>
        )}

        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-[var(--color-text-muted)]">
            Required: <code className="text-xs bg-[var(--color-surface-raised)] px-1 rounded">{requiredColumns.join(", ")}</code>
            <span className="block text-xs mt-1">
              Optional: <code className="text-xs bg-[var(--color-surface-raised)] px-1 rounded">{optionalColumns.join(", ")}</code>
            </span>
            <span className="block text-xs mt-1">
              German CSVs work too — semicolons, decimal commas (9,99), dates like 15.01.2024, and German column names.
            </span>
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => exportToCsv(`sales-import-${formatId}-template`, format.templateHeaders, [format.templateExample])}
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
            {checking && (
              <p className="text-sm text-[var(--color-text-muted)]">Checking for existing orders…</p>
            )}
            {!checking && errors.length === 0 && importable.length > 0 && (
              <p className="text-sm text-[var(--color-success)]">
                ✓ {importable.length} row{importable.length !== 1 ? "s" : ""} ready to import
                {skuMatchCount > 0 && (
                  <span className="text-[var(--color-text-muted)]"> · {skuMatchCount} linked to inventory via SKU</span>
                )}
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
            {!checking && errors.length === 0 && importable.length === 0 && skipped.length > 0 && (
              <p className="text-sm text-[var(--color-text-muted)]">
                All {skipped.length} row{skipped.length !== 1 ? "s" : ""} skipped —{" "}
                {skipReasonCounts.map(([reason, n]) => `${n} ${reason}`).join(", ")}.
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
