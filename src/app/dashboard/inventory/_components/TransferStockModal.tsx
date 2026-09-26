"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Field, Input, Row, Select, Textarea } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { useAdvancedInventory } from "../_store/useAdvancedInventory";
import { fetchAvailableLots } from "../_store/productLots";
import { lotReceivedLabel, lotSourceLabel } from "../_lib/productLots";
import {
  emptyTransferDraft,
  fifoPreview,
  parseTransferCost,
  parseTransferQuantity,
  transferDraftError,
  transferInsertPayload,
  transferLocationOptions,
  type TransferDraft,
  type TransferPortion,
} from "../_lib/transfers";
import type { StockLot, StockTransfer } from "@/types";

/** DataTable needs a string key; a lot appears at most once per preview. */
type PreviewRow = TransferPortion & { id: string };

const FORM_ID = "transfer-stock-form";
const today = () => new Date().toISOString().slice(0, 10);

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a transfer is recorded, so the page can refresh the history and stock. */
  onSaved: () => void;
}

/**
 * Source lots keyed by the "<product>:<location>" they were fetched for —
 * derived at render, never reset with a synchronous setState in the effect
 * (react-hooks/set-state-in-effect is an error here). Same pattern as
 * ProductLotsModal.tsx's LotsResult.
 */
interface SourceLotsResult {
  key: string;
  data: StockLot[] | null;
  error: string | null;
}

export function TransferStockModal({ open, onClose, onSaved }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const { locations, settings } = useAdvancedInventory();
  const products = useAppSelector((s) => s.inventory.selectorItems);
  const [draft, setDraft] = useState<TransferDraft>(() => emptyTransferDraft(settings?.default_location_id ?? null, today()));
  const [saving, setSaving] = useState(false);
  const [sourceResult, setSourceResult] = useState<SourceLotsResult | null>(null);

  const options = useMemo(() => transferLocationOptions(locations), [locations]);
  const sourceKey = draft.productId && draft.fromLocationId ? `${draft.productId}:${draft.fromLocationId}` : "";

  useEffect(() => {
    if (!open || sourceKey === "") return;
    let cancelled = false;
    const [productId, locationId] = sourceKey.split(":");
    fetchAvailableLots(productId, locationId)
      .then((rows) => {
        if (!cancelled) setSourceResult({ key: sourceKey, data: rows, error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setSourceResult({ key: sourceKey, data: null, error: e.message });
      });
    return () => { cancelled = true; };
  }, [open, sourceKey]);

  const sourceMatches = sourceKey !== "" && sourceResult?.key === sourceKey;
  const sourceLots = sourceMatches ? sourceResult!.data : null;
  const sourceError = sourceMatches ? sourceResult!.error : null;
  const sourceLoading = sourceKey !== "" && !sourceMatches;

  const quantity = parseTransferQuantity(draft.quantity);
  const cost = parseTransferCost(draft.transferCost);
  const preview = sourceLots ? fifoPreview(sourceLots, quantity ?? 0, cost.valid ? cost.value : null) : null;
  const available = preview ? preview.available : null;
  const draftError = transferDraftError(draft, locations, available);
  const isFormValid = draftError === null && !sourceLoading;
  const previewRows: PreviewRow[] = preview ? preview.portions.map((p) => ({ ...p, id: p.lot.id })) : [];

  const set = (patch: Partial<TransferDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? "Unknown location";
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "this product";

  function handleClose() {
    if (saving) return;
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid) return;
    setSaving(true);
    try {
      const supabase = await createTenantClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toastError("Transfer not saved", "Your session has expired. Please sign in again.");
        return;
      }
      const payload = transferInsertPayload(draft, user.id);
      const { data, error } = await supabase.from("stock_transfers").insert(payload).select("*").single<StockTransfer>();
      if (error || !data) {
        toastError("Transfer not saved", inventoryErrorMessage(error, "Could not record the transfer."));
        return;
      }
      try {
        const log = await writeAuditLog(supabase, {
          userId: user.id,
          userEmail: user.email ?? "",
          action: "create",
          entityType: "stock_transfer",
          entityId: data.id,
          metadata: {
            product_name: productName(data.product_id),
            from: locationName(data.from_location_id),
            to: locationName(data.to_location_id),
            quantity: data.quantity,
            transfer_cost: data.transfer_cost,
          },
        });
        if (log) dispatch(addAuditLog(log));
      } catch {
        // Best-effort: the transfer is already recorded.
      }
      success(
        "Stock transferred",
        `${data.quantity} × ${productName(data.product_id)} moved from ${locationName(data.from_location_id)} to ${locationName(data.to_location_id)}.`,
      );
      onSaved();
      onClose();
    } catch {
      toastError("Transfer not saved", "Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const previewColumns = [
    { header: "Batch", render: (p: PreviewRow) => <span className="text-sm text-(--color-text-base)">{lotSourceLabel(p.lot)}</span> },
    { header: "Received", render: (p: PreviewRow) => <span className="text-sm text-(--color-text-muted)">{lotReceivedLabel(p.lot)}</span> },
    { header: "Units", render: (p: PreviewRow) => <span className="text-sm tabular-nums text-(--color-text-base)">{p.take}</span> },
    { header: "Unit cost", render: (p: PreviewRow) => <span className="text-sm tabular-nums text-(--color-text-base)">{p.sourceUnitCost.toFixed(2)}</span> },
    { header: "At destination", render: (p: PreviewRow) => <span className="text-sm tabular-nums text-(--color-text-strong)">{p.destUnitCost.toFixed(2)}</span> },
  ];

  return (
    <Modal
      title="Transfer Stock"
      open={open}
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form={FORM_ID} disabled={saving || !isFormValid}>
            {saving ? "Transferring…" : "Transfer"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <Field label="Product" required>
          <Select value={draft.productId} onChange={(e) => set({ productId: e.target.value })} required>
            <option value="">— Choose a product —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>
            ))}
          </Select>
        </Field>

        <Row>
          <Field label="From" required>
            <Select value={draft.fromLocationId} onChange={(e) => set({ fromLocationId: e.target.value })} required>
              <option value="">— Choose —</option>
              {options.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="To" required>
            <Select value={draft.toLocationId} onChange={(e) => set({ toLocationId: e.target.value })} required>
              <option value="">— Choose —</option>
              {options.filter((l) => l.id !== draft.fromLocationId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        </Row>

        <Row>
          <Field label="Units" required>
            <Input type="number" min="1" step="1" value={draft.quantity} onChange={(e) => set({ quantity: e.target.value })} required />
          </Field>
          <Field label="Transfer cost (optional)">
            <Input type="number" min="0" step="0.01" value={draft.transferCost} onChange={(e) => set({ transferCost: e.target.value })} placeholder="0.00" />
          </Field>
        </Row>

        <Field label="Date" required>
          <Input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} required />
        </Field>

        <Field label="Note">
          <Textarea rows={2} value={draft.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. Inbound shipment FBA15XYZ" />
        </Field>
      </form>

      <div className="mt-6 space-y-2">
        <h3 className="text-sm font-semibold text-(--color-text-strong)">Batches that will move</h3>
        {sourceKey === "" ? (
          <p className="text-sm text-(--color-text-muted)">Choose a product and a source location to see its batches.</p>
        ) : sourceLoading ? (
          <p className="flex items-center gap-2 text-sm text-(--color-text-muted)">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Loading stock at {locationName(draft.fromLocationId)}…
          </p>
        ) : sourceError ? (
          <p className="text-sm text-(--color-danger-text)">{sourceError}</p>
        ) : preview ? (
          <>
            <p className="text-xs text-(--color-text-muted)">
              Available at {locationName(draft.fromLocationId)}: <span className="tabular-nums">{preview.available}</span> units. Oldest batches move first; each keeps its cost{preview.addon > 0 ? `, plus ${preview.addon.toFixed(4)} per unit transfer cost` : ""}.
            </p>
            <DataTable
              columns={previewColumns}
              rows={previewRows}
              keyField="id"
              emptyMessage={preview.available === 0 ? "No stock at this location to transfer." : "Enter how many units to move."}
            />
            {preview.destAvgUnitCost !== null && (
              <p className="text-sm text-(--color-text-base)">
                Arrives at <span className="tabular-nums font-medium">{preview.destAvgUnitCost.toFixed(2)}</span> per unit on average
                (<span className="tabular-nums">{preview.movedCost.toFixed(2)}</span> total).
              </p>
            )}
          </>
        ) : null}
        {draftError && (draft.quantity !== "" || draft.toLocationId !== "") && (
          <p className="text-xs text-(--color-danger-text)">{draftError}</p>
        )}
      </div>
    </Modal>
  );
}
