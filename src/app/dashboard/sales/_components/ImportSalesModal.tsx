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
import {
  detectDateOrder,
  firstAmbiguousDate,
  hasOrderSensitiveDate,
  parseFlexibleDate,
  type DateOrder,
  type DateOrderDetection,
} from "@/lib/utils/localeParse";
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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Format an ISO `YYYY-MM-DD` string as "10 April 2026" without going
 * through `Date`/`toLocaleDateString` — those apply the viewer's timezone,
 * which can shift the displayed day for a plain calendar date. */
function formatIsoHuman(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * `refundsAlreadyApplied` counts refunds whose sale already had a
 * refunded_amount — deducting again on a re-import would halve the order.
 * `refundsExceeded` is kept separate from `refundsSkipped` because folding
 * the two together would report "no matching order found" for a refund that
 * matched perfectly well and was only rejected for being too large.
 */
export interface ImportSummary {
  inserted: number;
  refundsApplied: number;
  /** No matching order. */
  refundsSkipped: number;
  /** Refund larger than the matched order — that order was left unchanged. */
  refundsExceeded: number;
  refundsAlreadyApplied: number;
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
  // null = trust detection. A non-null value is the user forcing an order,
  // which is only honoured when the file has no hard evidence to the contrary.
  const [dateOrderOverride, setDateOrderOverride] = useState<DateOrder | null>(null);
  const [dateDetection, setDateDetection] = useState<DateOrderDetection | null>(null);
  // A real ambiguous date from the file, for the "will be imported as…" hint —
  // undefined when the file has none (e.g. all ISO/dot-separated).
  const [dateSample, setDateSample] = useState<string | undefined>(undefined);
  // False when every date in the file is dot-separated — `order` is then a
  // no-op (parseFlexibleDate always reads dot dates day-first), so the
  // explicit Day/Month-first choice is disabled rather than silently ignored.
  const [orderSensitiveDates, setOrderSensitiveDates] = useState(true);
  // Guards against a stale parseAndValidate() call (from a fast double
  // format/date-order change) overwriting a newer one's result — both
  // results differ only in interpretation, so a stale write is silent and
  // hard to notice. Incremented on every call; a result is applied only if
  // its captured id is still current when it resolves.
  const requestIdRef = useRef(0);

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
  // A REFUND row has `data: null`, so it can never be in `importable` — but it
  // is still real work (it deducts from an existing sale). Count it separately
  // or a refunds-only file reads as "Import 0 rows" and cannot be imported.
  const refundCount = parsed.filter((r) => r.isRefund && !r.skipped).length;
  const actionableCount = importable.length + refundCount;
  const canImport =
    parsed.length > 0 &&
    errors.length === 0 &&
    (importable.length > 0 || refundCount > 0) &&
    !checking;

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

  // Concrete "this date will be read as X" hint for the ambiguous-detection
  // case — replaces a generic "check the preview" pointer to a preview the
  // modal doesn't have. Uses a real sample from the file, parsed with
  // whatever order will actually be applied (override, or the detected one).
  const ambiguousDateHint = useMemo(() => {
    if (!dateSample || !dateDetection) return null;
    const order = dateOrderOverride ?? dateDetection.order;
    const iso = parseFlexibleDate(dateSample, order);
    if (!iso) return null;
    return `"${dateSample}" will be imported as ${formatIsoHuman(iso)}. Set the date format explicitly if that is wrong.`;
  }, [dateSample, dateDetection, dateOrderOverride]);

  function reset() {
    setParsed([]);
    setParsedSource(null);
    setFileName("");
    setImportError(null);
    setDateOrderOverride(null);
    setDateDetection(null);
    setDateSample(undefined);
    setOrderSensitiveDates(true);
    if (fileRef.current) fileRef.current.value = "";
  }

  /**
   * Abort mid-import, after rows have already been committed. The sales are
   * in the table, so the file must NOT stay importable: a second click would
   * re-insert them and the unique index on (platform, external_order_id)
   * would surface a raw Postgres error to the user. Clearing the parsed rows
   * disables the Import button, and clearing the file input means selecting
   * the SAME file again still fires `change` (a browser suppresses it
   * otherwise). `importError` is deliberately left alone — the caller sets it
   * and it must survive this.
   */
  function blockRetry() {
    setParsed([]);
    setParsedSource(null);
    setFileName("");
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
  async function markDuplicates(rows: ParsedRow[], requestId: number): Promise<ParsedRow[]> {
    const seen = new Set<string>();
    const withFileDupes = rows.map((r) => {
      // REFUND rows are not new orders. They carry the external_order_id of an
      // EXISTING sale by definition, so the dedup passes would mark every one
      // "order already exists" and drop it before matching could run.
      if (r.isRefund) return r;
      if (!r.data?.external_order_id) return r;
      const key = `${r.data.platform}:${r.data.external_order_id}`;
      if (seen.has(key)) return { ...r, skipped: "duplicate in file" };
      seen.add(key);
      return r;
    });

    const byPlatform = new Map<Platform, string[]>();
    for (const r of withFileDupes) {
      if (!r.isRefund && r.data?.external_order_id && !r.skipped) {
        const list = byPlatform.get(r.data.platform) ?? [];
        list.push(r.data.external_order_id);
        byPlatform.set(r.data.platform, list);
      }
    }
    if (byPlatform.size === 0) return withFileDupes;

    // Guard: don't flip `checking` on behalf of a call that's already stale
    // by the time we reach the network round-trip — a newer parseAndValidate
    // invocation may already be running with its own checking state.
    if (requestId === requestIdRef.current) setChecking(true);
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
        // REFUND rows are not new orders. They carry the external_order_id of an
        // EXISTING sale by definition, so the dedup passes would mark every one
        // "order already exists" and drop it before matching could run.
        if (r.isRefund) return r;
        return r.data?.external_order_id && !r.skipped && existing.has(`${r.data.platform}:${r.data.external_order_id}`)
          ? { ...r, skipped: "order already exists" }
          : r;
      });
    } finally {
      // Only the CURRENT request may clear `checking` — a stale one clearing
      // it would unblock the Import button while a newer check is in flight.
      if (requestId === requestIdRef.current) setChecking(false);
    }
  }

  async function parseAndValidate(
    source: ParsedSource,
    fmtId: ImportFormatId,
    override: DateOrder | null,
  ) {
    // Run-id guard (see the comment on requestIdRef): two rapid format/date-order
    // changes each call this function; only the LAST one's result should ever
    // land in state. `requestId` is captured now and re-checked before every
    // state write that follows an `await`.
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestIdRef.current === requestId;

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
    const dateValues = canonical.map((r) => r.date ?? "");
    const detection = detectDateOrder(dateValues);
    const orderSensitive = hasOrderSensitiveDate(dateValues);
    setDateDetection(detection);
    setDateSample(firstAmbiguousDate(dateValues));
    setOrderSensitiveDates(orderSensitive);

    if (detection.conflict) {
      const { kind, sampleA, sampleB } = detection.conflict;
      const error =
        kind === "separator"
          ? `This file mixes date separators — it contains "${sampleA}" and "${sampleB}". That usually means a spreadsheet tool (e.g. Excel) silently rewrote some date cells while leaving others as text, so the column can no longer be trusted. Re-export the file with one consistent date format before importing.`
          : `This file mixes date formats — it contains "${sampleA}" (day first) and "${sampleB}" (month first). No single rule can read both correctly. Fix the file before importing.`;
      setParsed([{ rowNum: 0, data: null, error }]);
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
    if (!isCurrent()) return; // a newer format/date-order change has already superseded this run
    setParsed(validated); // show validation results immediately…
    try {
      const deduped = await markDuplicates(validated, requestId); // …then refine with the dedup check
      if (!isCurrent()) return; // superseded while the dedup query was in flight
      setParsed(deduped);
    } catch (err) {
      if (!isCurrent()) return;
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

    // A REFUND row parses to `data: null`, so it is excluded from `importable`
    // by construction — collect it from `parsed` directly. That also keeps it
    // out of `payload` for free.
    const refundRows = parsed.filter((r) => r.isRefund && !r.skipped);
    const insertRows = importable.filter((r) => !r.isRefund);

    // Insert the sale rows FIRST, and match/apply refunds AFTER.
    // An Amazon monthly report routinely contains both the SALE and the
    // REFUND for one order (sold 3 April, refunded 24 April — same
    // period, same file). If refunds were matched before the insert, the
    // refund's query against `sales` would run before its own SALE row
    // existed, find nothing, and be skipped as "no matching order" even
    // though the order is sitting right there in `payload`. Running the
    // insert first means a same-file refund can match a row that was
    // just committed moments earlier.
    //
    // The insert is built from `insertRows` only — a refund never enters
    // `payload`; refunds are applied via `update`, not `insert`, below.
    const payload = insertRows.map((r) => {
      const productId = r.sku ? (skuToProductId.get(r.sku.toLowerCase()) ?? null) : null;
      return { ...r.data!, created_by: user.id, product_id: productId };
    });

    let inserted: Sale[] = [];
    if (payload.length > 0) {
      const { data, error } = await supabase.from("sales").insert(payload).select();
      if (error) {
        // Insert failed — do not run the refunds loop at all. Otherwise a
        // refund could be deducted from a batch whose sale rows never made
        // it into the table.
        setImportError(error.message);
        setLoading(false);
        return;
      }
      inserted = data as Sale[];
      for (const sale of inserted) dispatch(addSale(sale));
    }

    // Batch entry for the INSERT, written as soon as the insert succeeds and
    // before the refund loop can bail. Writing it after the loop meant an
    // abort lost the `bulk_import` record for rows that really did land,
    // while the per-refund entries written earlier in the same run survived —
    // an internally inconsistent trail. Refund outcomes are audited per sale
    // inside the loop; skips change no data and so are not audited.
    const log = await writeAuditLog(supabase, {
      userId: user.id,
      userEmail: user.email ?? "",
      action: "create",
      entityType: "sale",
      metadata: {
        bulk_import: true,
        count: inserted.length,
        format: formatId,
        skipped: skipped.length,
      },
    });
    if (log) dispatch(addAuditLog(log));

    // Match each refund on platform + external_order_id + the product resolved
    // from SKU. Order ids are unique only within a platform (an eBay sale could
    // share an id with an unrelated Amazon one), and NOT unique within an
    // Amazon sheet — a multi-line order such as 028-6107376-1547566 appears
    // once per SKU — so platform and product must both be part of the key or
    // the wrong line gets deducted.
    const unmatchedRefunds: ParsedRow[] = [];
    const alreadyRefunded: ParsedRow[] = [];
    const exceededRefunds: ParsedRow[] = [];
    // Counted as they happen rather than derived at the end, because the two
    // error bails below have to report how many were applied before the abort.
    let appliedRefunds = 0;
    // Both bails leave committed work in place, so the message must say what
    // survived instead of implying a clean retry is available.
    const abortNotice = (lead: string) =>
      `${lead} ${inserted.length} order${inserted.length !== 1 ? "s" : ""} and ` +
      `${appliedRefunds} refund${appliedRefunds !== 1 ? "s" : ""} were already saved and have been kept. ` +
      `Re-select the file to continue.`;

    for (const r of refundRows) {
      const target = r.refund!;
      const productId = r.sku ? (skuToProductId.get(r.sku.toLowerCase()) ?? null) : null;
      if (!productId) {
        unmatchedRefunds.push({ ...r, skipped: "refund: no matching order" });
        continue;
      }
      const { data: match, error: matchErr } = await supabase
        .from("sales")
        .select("*")
        .eq("platform", target.platform)
        .eq("external_order_id", target.externalOrderId)
        .eq("product_id", productId)
        .limit(1);
      if (matchErr) {
        setImportError(abortNotice("Could not check existing orders for refunds."));
        blockRetry();
        setLoading(false);
        return;
      }
      if (!match || match.length === 0) {
        unmatchedRefunds.push({ ...r, skipped: "refund: no matching order" });
        continue;
      }
      const previous = match[0] as Sale;

      // Already refunded → no-op. Deducting again would halve the order.
      //
      // Deliberately `!=` and not `!==`: until migration 031 is applied, the
      // column does not exist in the tenant schema and this reads `undefined`,
      // not `null`. A strict check would treat EVERY refund as already
      // applied, deduct nothing, and still report success — a silent no-op
      // with a reassuring toast, the worst failure available here. The loose
      // check falls through to the `update` instead, which Supabase rejects
      // for the missing column, surfacing on the `updErr` path as a visible
      // error. Do not "tighten" this.
      if (previous.refunded_amount != null) {
        alreadyRefunded.push({ ...r, skipped: "refund already applied" });
        continue;
      }

      // A refund bigger than what the order actually holds means the match is
      // wrong or the sheet is malformed — skip the ROW and carry on, rather
      // than writing a negative total or aborting the whole import. Each
      // portion is checked against its own column: a single combined check
      // would pass a refund that fits overall but over-deducts one side.
      if (
        target.itemAmount > previous.total_amount ||
        target.shippingAmount > (previous.shipping_charged ?? 0)
      ) {
        exceededRefunds.push({ ...r, skipped: "refund exceeds the matched order" });
        continue;
      }

      // Clamped at zero: `vat_amount` has no CHECK constraint, and a negative
      // would corrupt the Overview page's VAT-Position aggregate silently.
      const nextVat =
        previous.vat_amount === null || target.vatAmount === null
          ? previous.vat_amount
          : Math.max(0, round2(previous.vat_amount - target.vatAmount));

      const { data: updated, error: updErr } = await supabase
        .from("sales")
        .update({
          // total_amount holds the ITEM total only; shipping is its own
          // column. Deducting the full activity value from total_amount
          // would over-deduct by the shipping portion on every shipped order.
          total_amount: round2(previous.total_amount - target.itemAmount),
          // Left exactly as-is when there is no shipping portion — including
          // when it is null, which must not become 0.
          shipping_charged:
            target.shippingAmount > 0
              ? round2((previous.shipping_charged ?? 0) - target.shippingAmount)
              : previous.shipping_charged,
          vat_amount: nextVat,
          status: "refunded",
          refunded_amount: target.amount,
        })
        .eq("id", previous.id)
        .select()
        .single<Sale>();
      if (updErr || !updated) {
        setImportError(abortNotice("Could not apply a refund."));
        blockRetry();
        setLoading(false);
        return;
      }
      dispatch(updateSale(updated));
      appliedRefunds += 1;

      const refundLog = await writeAuditLog(supabase, {
        userId: user.id,
        userEmail: user.email ?? "",
        action: "update",
        entityType: "sale",
        entityId: previous.id,
        metadata: {
          before: {
            status: previous.status,
            total_amount: previous.total_amount,
            shipping_charged: previous.shipping_charged,
            vat_amount: previous.vat_amount,
            refunded_amount: previous.refunded_amount,
          },
          after: {
            status: updated.status,
            total_amount: updated.total_amount,
            shipping_charged: updated.shipping_charged,
            vat_amount: updated.vat_amount,
            refunded_amount: updated.refunded_amount,
          },
          reason: "bulk import: applied refund",
          bulk_import: true,
          external_order_id: target.externalOrderId,
        },
      });
      if (refundLog) dispatch(addAuditLog(refundLog));
    }

    setLoading(false);
    reset();
    onSuccess({
      inserted: inserted.length,
      refundsApplied: appliedRefunds,
      refundsSkipped: unmatchedRefunds.length,
      refundsExceeded: exceededRefunds.length,
      refundsAlreadyApplied: alreadyRefunded.length,
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
            {loading ? "Importing…" : checking ? "Checking…" : canImport ? `Import ${actionableCount} row${actionableCount !== 1 ? "s" : ""}` : "Import"}
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
              disabled={!orderSensitiveDates}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 disabled:opacity-60"
            >
              <option value="auto">
                {dateDetection.conflict
                  ? "Mixed formats — cannot import"
                  : !orderSensitiveDates
                    ? "Fixed — DD.MM.YYYY (dot dates)"
                    : dateDetection.confident
                      ? `Auto — detected ${dateDetection.order === "dmy" ? "DD-MM-YYYY" : "MM-DD-YYYY"}`
                      : "Auto — could not tell, assuming DD-MM-YYYY"}
              </option>
              <option value="dmy">Day first (DD-MM-YYYY)</option>
              <option value="mdy">Month first (MM-DD-YYYY)</option>
            </select>
          </label>
        )}
        {dateDetection && !orderSensitiveDates && !dateDetection.conflict && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Every date in this file uses dots (e.g. DD.MM.YYYY) — that format is always read
            day-first, so the Day/Month-first choice has no effect here.
          </p>
        )}
        {dateDetection && orderSensitiveDates && !dateDetection.confident && !dateDetection.conflict && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Every date in this file reads the same either way, so the format could not be
            detected.{" "}
            {ambiguousDateHint ?? "Set the date format explicitly if the assumed reading is wrong."}
          </p>
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
            {!checking && errors.length === 0 && actionableCount > 0 && (
              <p className="text-sm text-[var(--color-success)]">
                ✓ {actionableCount} row{actionableCount !== 1 ? "s" : ""} ready to import
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
            {!checking && errors.length === 0 && actionableCount === 0 && skipped.length > 0 && (
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
          </div>
        )}

        {/* Outside the `parsed.length > 0` block on purpose: the mid-import
            bails call `blockRetry()`, which clears `parsed` so the import
            cannot be re-run. Nested here, the explanation would vanish with
            it and the modal would look like nothing had happened. */}
        {importError && (
          <p className="text-sm text-[var(--color-danger)]">Import failed: {importError}</p>
        )}
      </div>
    </Modal>
  );
}
