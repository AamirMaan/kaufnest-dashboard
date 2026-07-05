"use client";

import { useRef, useState } from "react";
import { useAppDispatch } from "@/store/hooks";
import { addSale } from "../_store/salesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/FormFields";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { parseCsvText, exportToCsv } from "@/lib/utils/csv";
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

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
}

export function ImportSalesModal({ open, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const fileRef = useRef<HTMLInputElement>(null);
  const [formatId, setFormatId] = useState<ImportFormatId>("generic");
  const [rawText, setRawText] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const format = IMPORT_FORMATS[formatId];
  const requiredColumns = format.columns.filter((c) => c.required).map((c) => c.key);

  const errors = parsed.filter((r) => r.error !== null);
  const skipped = parsed.filter((r) => r.skipped);
  const importable = parsed.filter((r) => r.data !== null && !r.skipped);
  const canImport = parsed.length > 0 && errors.length === 0 && importable.length > 0 && !checking;

  function reset() {
    setParsed([]);
    setRawText(null);
    setFileName("");
    setImportError(null);
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
      if (!r.data?.external_order_id) return r;
      const key = `${r.data.platform}:${r.data.external_order_id}`;
      if (seen.has(key)) return { ...r, skipped: "duplicate in file" };
      seen.add(key);
      return r;
    });

    const byPlatform = new Map<Platform, string[]>();
    for (const r of withFileDupes) {
      if (r.data?.external_order_id && !r.skipped) {
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
      return withFileDupes.map((r) =>
        r.data?.external_order_id && !r.skipped && existing.has(`${r.data.platform}:${r.data.external_order_id}`)
          ? { ...r, skipped: "order already exists" }
          : r,
      );
    } finally {
      setChecking(false);
    }
  }

  async function parseAndValidate(text: string, fmtId: ImportFormatId) {
    const fmt = IMPORT_FORMATS[fmtId];
    const { headers, rows } = parseCsvText(text);
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
    const validated = rows.map((row, i) =>
      validateRowForFormat(fmt, canonicalizeRow(row, mapping), i + 2),
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
    if (rawText !== null) {
      void parseAndValidate(rawText, next);
    } else {
      setParsed([]);
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportError(null);
    readFileText(file)
      .then((text) => {
        setRawText(text);
        return parseAndValidate(text, formatId);
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

    const payload = importable.map((r) => ({ ...r.data!, created_by: user.id }));
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
      metadata: { bulk_import: true, count: inserted.length, format: formatId, skipped: skipped.length },
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

        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-[var(--color-text-muted)]">
            Required columns: <code className="text-xs bg-[var(--color-surface-raised)] px-1 rounded">{requiredColumns.join(", ")}</code>
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
            {fileName || "Click to select a CSV file"}
          </span>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
        </div>

        {parsed.length > 0 && (
          <div className="space-y-2">
            {checking && (
              <p className="text-sm text-[var(--color-text-muted)]">Checking for existing orders…</p>
            )}
            {!checking && errors.length === 0 && importable.length > 0 && (
              <p className="text-sm text-[var(--color-success)]">
                ✓ {importable.length} row{importable.length !== 1 ? "s" : ""} ready to import
                {skipped.length > 0 && (
                  <span className="text-[var(--color-text-muted)]"> · {skipped.length} skipped (order already exists)</span>
                )}
              </p>
            )}
            {!checking && errors.length === 0 && importable.length === 0 && skipped.length > 0 && (
              <p className="text-sm text-[var(--color-text-muted)]">
                All {skipped.length} row{skipped.length !== 1 ? "s" : ""} skipped — these orders already exist.
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
