"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { Field, Input } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch } from "@/store/hooks";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { useAdvancedInventory } from "../_store/useAdvancedInventory";
import { fetchOpenLots } from "../_store/productLots";
import { canEditLotCost, lotReceivedLabel, lotSourceLabel, parseUnitCostInput, sortLotsFifo } from "../_lib/productLots";
import type { Product, StockLot } from "@/types";

const FORM_ID = "opening-cost-form";

interface Props {
  product: Product | null;
  canManage: boolean;
  onClose: () => void;
  /** Called after an opening cost is saved, so the page can re-fetch stock (Avg. cost). */
  onChanged?: () => void;
}

/**
 * Batches load result keyed by the product it was fetched for — NOT reset
 * with a synchronous setState in the effect body (that trips this repo's
 * react-hooks/set-state-in-effect lint rule, an error here). Same pattern as
 * ProductsTab.tsx's `StockRequestResult` and FulfillmentLocationField.tsx's
 * keyed `stock` state: a stale result from a since-switched product is simply
 * ignored by the key comparison below. The load effect inlines its
 * `.then`/`.catch` rather than delegating to a `useCallback` helper — the
 * lint rule flags calling a `useCallback` that itself sets state from an
 * effect even when that call happens after an `await`.
 */
interface LotsResult {
  key: string;
  data: StockLot[] | null;
  error: string | null;
}

export function ProductLotsModal({ product, canManage, onClose, onChanged }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const { locations } = useAdvancedInventory();
  const [result, setResult] = useState<LotsResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [costInput, setCostInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Inlined (not delegated to a helper called from the effect) — the lint
  // rule below traces a useCallback that itself calls setState and flags
  // calling it from an effect even though the setState happens after an
  // await. Same shape as FulfillmentLocationField.tsx's stock-lookup effect.
  useEffect(() => {
    if (!product) return;
    let cancelled = false;
    const productId = product.id;
    fetchOpenLots(productId)
      .then((rows) => {
        if (!cancelled) setResult({ key: productId, data: sortLotsFifo(rows), error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setResult({ key: productId, data: null, error: e.message });
      });
    return () => { cancelled = true; };
  }, [product]);

  // Reused by handleSaveCost after a successful edit — safe to call setState
  // directly here since this isn't invoked from an effect.
  const reload = useCallback(async (productId: string) => {
    try {
      const rows = await fetchOpenLots(productId);
      setResult({ key: productId, data: sortLotsFifo(rows), error: null });
    } catch (e) {
      setResult({ key: productId, data: null, error: (e as Error).message });
    }
  }, []);

  const matches = !!product && result?.key === product.id;
  const lots = matches ? result!.data : null;
  const loadError = matches ? result!.error : null;
  // Derived, not a separate reset call: a lot id from a since-closed product
  // never matches the new product's (globally unique) lot ids, so switching
  // products naturally hides any edit form left open — see handleClose below
  // for the one case (reopening the SAME product) this derivation can't cover.
  const editing = lots?.find((l) => l.id === editingId) ?? null;

  const parsedCost = parseUnitCostInput(costInput);

  function handleClose() {
    if (saving) return;
    setEditingId(null);
    onClose();
  }

  async function handleSaveCost(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !product || parsedCost === null) return;
    setSaving(true);
    try {
      const supabase = await createTenantClient();
      const { error } = await supabase.rpc("set_opening_lot_cost", { p_lot_id: editing.id, p_unit_cost: parsedCost });
      if (error) {
        toastError("Cost not saved", inventoryErrorMessage(error, "Could not change the opening cost."));
        return;
      }
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const log = await writeAuditLog(supabase, {
            userId: user.id,
            userEmail: user.email ?? "",
            action: "update",
            entityType: "product",
            entityId: product.id,
            metadata: { event: "opening_cost_changed", lot_id: editing.id, before: editing.unit_cost, after: parsedCost },
          });
          if (log) dispatch(addAuditLog(log));
        }
      } catch {
        // audit is best-effort; the cost is already saved
      }
      success("Opening cost saved", "Orders that used these units were re-costed.");
      setEditingId(null);
      onChanged?.();
      await reload(product.id);
    } catch {
      toastError("Cost not saved", "Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? "Unknown location";

  const columns = [
    { header: "Batch", render: (l: StockLot) => <span className="text-sm text-(--color-text-base)">{lotSourceLabel(l)}</span> },
    { header: "Location", render: (l: StockLot) => <span className="text-sm text-(--color-text-base)">{locationName(l.location_id)}</span> },
    { header: "Received", render: (l: StockLot) => <span className="text-sm text-(--color-text-muted)">{lotReceivedLabel(l)}</span> },
    {
      header: "Remaining",
      render: (l: StockLot) =>
        l.kind === "shortfall" ? (
          <Badge label={`${l.qty_remaining}`} variant="danger" />
        ) : (
          <span className="text-sm tabular-nums text-(--color-text-base)">{l.qty_remaining}</span>
        ),
    },
    {
      header: "Unit cost",
      render: (l: StockLot) => (
        <span className="flex items-center gap-1">
          <span className="text-sm tabular-nums text-(--color-text-base)">{Number(l.unit_cost).toFixed(2)}</span>
          {canEditLotCost(l, canManage) && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => { setEditingId(l.id); setCostInput(String(l.unit_cost)); }}
              title="Edit opening cost"
              aria-label="Edit opening cost"
            >
              <Pencil size={14} />
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <Modal
      title={product ? `Batches · ${product.name}` : "Batches"}
      open={!!product}
      onClose={handleClose}
      footer={
        editing ? (
          <>
            <Button variant="secondary" type="button" onClick={() => setEditingId(null)} disabled={saving}>Cancel</Button>
            <Button type="submit" form={FORM_ID} disabled={saving || parsedCost === null}>
              {saving ? "Saving…" : "Save cost"}
            </Button>
          </>
        ) : (
          <Button variant="secondary" type="button" onClick={handleClose}>Close</Button>
        )
      }
    >
      {loadError && <p className="mb-3 text-sm text-(--color-danger-text)">{loadError}</p>}
      {lots === null && !loadError ? (
        <p className="flex items-center gap-2 text-sm text-(--color-text-muted)">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Loading batches…
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={lots ?? []}
          keyField="id"
          emptyMessage="No batches with stock left and no opening balance — record a purchase to add one."
        />
      )}

      {editing && (
        <form id={FORM_ID} onSubmit={handleSaveCost} className="mt-4 space-y-2">
          <Field label="Opening unit cost" required>
            <Input type="number" min="0" step="0.0001" value={costInput} onChange={(e) => setCostInput(e.target.value)} required />
          </Field>
          <p className="text-xs text-(--color-text-muted)">
            Orders and transfers that used these units are re-costed automatically.
          </p>
        </form>
      )}
    </Modal>
  );
}
