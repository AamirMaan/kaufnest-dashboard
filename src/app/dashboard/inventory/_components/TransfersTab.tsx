"use client";

import { useEffect, useState } from "react";
import { ArrowRight, RefreshCw, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatDate } from "@/lib/utils/date";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { fetchTransfersPage, type StockTransferRow } from "../_store/transfersSlice";
import { pageAfterRemoval } from "../_lib/transfers";
import { TransferStockModal } from "./TransferStockModal";

interface Props {
  isAdmin: boolean;
  /** The page header owns the "+ Transfer Stock" button; this tab owns the modal. */
  addOpen: boolean;
  onAddClose: () => void;
  /** Kept mounted while another tab shows (same as LocationsTab). */
  hidden?: boolean;
  /** A transfer was recorded or deleted — per-location stock elsewhere is stale. */
  onStockChanged: () => void;
}

export function TransfersTab({ isAdmin, addOpen, onAddClose, hidden, onStockChanged }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const { items, page, pageSize, total, loaded, isFetching, error } = useAppSelector((s) => s.stockTransfers);
  const locations = useAppSelector((s) => s.advancedInventory.locations);
  const [deleteTarget, setDeleteTarget] = useState<StockTransferRow | null>(null);

  useEffect(() => {
    if (!loaded) dispatch(fetchTransfersPage({ page: 1, pageSize }));
  }, [loaded, pageSize, dispatch]);

  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? "Unknown location";
  const productLabel = (t: StockTransferRow) => t.product_name ?? "Deleted product";

  // "Loading…" only applies to the very first, still-in-flight fetch — once
  // that fetch has settled (loaded), a subsequent error must not keep
  // claiming to be loading (the error banner above already carries the
  // detail + Retry). The button hint in the empty-but-loaded case is only
  // true for admins, who are the only ones who see a "Transfer Stock" button.
  const emptyMessage = !loaded
    ? error
      ? "Transfers couldn't be loaded."
      : "Loading transfers…"
    : isAdmin
      ? "No transfers yet — move stock between your locations with “Transfer Stock”."
      : "No transfers yet.";

  function handleSaved() {
    dispatch(fetchTransfersPage({ page: 1, pageSize }));
    onStockChanged();
  }

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      const supabase = await createTenantClient();
      const { data, error: deleteError } = await supabase.from("stock_transfers").delete().eq("id", target.id).select("id");
      if (deleteError) {
        toastError("Delete failed", inventoryErrorMessage(deleteError, "Could not delete the transfer."));
        return;
      }
      if (!data || data.length === 0) {
        toastError("Delete failed", "You don't have permission to delete this transfer, or it no longer exists.");
        return;
      }
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const log = await writeAuditLog(supabase, {
            userId: user.id,
            userEmail: user.email ?? "",
            action: "delete",
            entityType: "stock_transfer",
            entityId: target.id,
            metadata: {
              before: target,
              product_name: productLabel(target),
              from: locationName(target.from_location_id),
              to: locationName(target.to_location_id),
              reason,
            },
          });
          if (log) dispatch(addAuditLog(log));
        }
      } catch {
        // Best-effort: the transfer is already deleted.
      }
      success("Transfer deleted", `${target.quantity} × ${productLabel(target)} are back at ${locationName(target.from_location_id)}.`);
      setDeleteTarget(null);
      dispatch(fetchTransfersPage({ page: pageAfterRemoval(page, pageSize, total), pageSize }));
      onStockChanged();
    } catch {
      // Keep deleteTarget so the modal stays open for a retry.
      toastError("Delete failed", "Please check your connection and try again.");
    }
  }

  const columns = [
    { header: "Date", render: (t: StockTransferRow) => <span className="text-sm text-(--color-text-base)">{formatDate(t.date)}</span> },
    { header: "Product", render: (t: StockTransferRow) => <span className="text-sm font-medium text-(--color-text-strong)">{productLabel(t)}</span> },
    {
      header: "Route",
      render: (t: StockTransferRow) => (
        <span className="flex items-center gap-1 text-sm text-(--color-text-base)">
          {locationName(t.from_location_id)} <ArrowRight size={14} aria-hidden /> <span className="sr-only">to</span> {locationName(t.to_location_id)}
        </span>
      ),
    },
    { header: "Units", render: (t: StockTransferRow) => <span className="text-sm tabular-nums text-(--color-text-base)">{t.quantity}</span> },
    {
      header: "Transfer cost",
      render: (t: StockTransferRow) => (
        <span className="text-sm tabular-nums text-(--color-text-base)">{t.transfer_cost === null ? "—" : Number(t.transfer_cost).toFixed(2)}</span>
      ),
    },
    { header: "Note", render: (t: StockTransferRow) => <span className="text-sm text-(--color-text-muted)">{t.note ?? ""}</span> },
    ...(isAdmin
      ? [
          {
            header: "Actions",
            render: (t: StockTransferRow) => (
              <Button size="icon" variant="danger" onClick={() => setDeleteTarget(t)} title="Delete" aria-label={`Delete transfer of ${productLabel(t)}`}>
                <Trash2 size={15} />
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div id="inventory-panel-transfers" role="tabpanel" aria-labelledby="inventory-tab-transfers" hidden={hidden} className="space-y-4">
      {!isAdmin && <p className="text-sm text-(--color-text-muted)">Only admins can record or delete transfers.</p>}

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4">
          <p className="text-sm text-(--color-text-muted)">{error}</p>
          <Button variant="secondary" onClick={() => dispatch(fetchTransfersPage({ page, pageSize }))}>
            <RefreshCw size={15} aria-hidden /> Retry
          </Button>
        </div>
      )}

      <div className={isFetching ? "opacity-60 pointer-events-none transition-opacity" : ""}>
        <DataTable
          columns={columns}
          rows={items}
          keyField="id"
          emptyMessage={emptyMessage}
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(p) => dispatch(fetchTransfersPage({ page: p, pageSize }))}
          onPageSizeChange={(s) => dispatch(fetchTransfersPage({ page: 1, pageSize: s }))}
        />
      </div>

      {isAdmin && addOpen && <TransferStockModal open onClose={onAddClose} onSaved={handleSaved} />}
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Transfer"
        description={
          deleteTarget
            ? `Move ${deleteTarget.quantity} × ${productLabel(deleteTarget)} back from ${locationName(deleteTarget.to_location_id)} to ${locationName(deleteTarget.from_location_id)}? This only works while none of the transferred units have been sold or moved on.`
            : ""
        }
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
