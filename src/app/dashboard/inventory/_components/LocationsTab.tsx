"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { locationRemoved, locationSaved } from "../_store/advancedInventorySlice";
import { LOCATION_TYPE_LABELS, locationDeactivationBlocker, sortLocations } from "../_lib/advancedInventory";
import { LocationModal } from "./LocationModal";
import { FulfillmentDefaultsCard } from "./FulfillmentDefaultsCard";
import type { StockLocation } from "@/types";

interface Props {
  isAdmin: boolean;
  /** The page header owns the "+ Add Location" button; this tab owns the modal. */
  addOpen: boolean;
  onAddClose: () => void;
  /**
   * Kept mounted while the Products tab is showing (so search/form state
   * survives switching tabs) — this just hides the panel visually/from
   * assistive tech, matching the native `hidden` attribute's semantics.
   */
  hidden?: boolean;
}

const CONNECTION_ERROR = "Please check your connection and try again.";

export function LocationsTab({ isAdmin, addOpen, onAddClose, hidden }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError, warning } = useToast();
  const locations = useAppSelector((s) => s.advancedInventory.locations);
  const settings = useAppSelector((s) => s.advancedInventory.settings);
  const platformDefaults = useAppSelector((s) => s.advancedInventory.platformDefaults);
  const [editTarget, setEditTarget] = useState<StockLocation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StockLocation | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Remounts FulfillmentDefaultsCard whenever the stored defaults/locations
  // change (save elsewhere, reload) so its local draft always starts from
  // the current saved values instead of a stale first-render snapshot.
  const defaultsKey = [
    settings?.default_location_id ?? "",
    locations.map((l) => `${l.id}:${l.is_active ? 1 : 0}`).join(","),
    [...platformDefaults].sort((a, b) => a.platform.localeCompare(b.platform)).map((d) => `${d.platform}=${d.location_id}`).join(","),
  ].join("|");

  async function audit(action: "update" | "delete", location: StockLocation, metadata: Record<string, unknown>) {
    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const log = await writeAuditLog(supabase, {
      userId: user.id,
      userEmail: user.email ?? "",
      action,
      entityType: "stock_location",
      entityId: location.id,
      metadata,
    });
    if (log) dispatch(addAuditLog(log));
  }

  async function handleToggleActive(location: StockLocation) {
    const blocker = locationDeactivationBlocker(location, settings, platformDefaults);
    if (blocker) {
      warning("Can't deactivate", blocker);
      return;
    }
    setTogglingId(location.id);
    try {
      const supabase = await createTenantClient();
      const { data, error } = await supabase
        .from("stock_locations")
        .update({ is_active: !location.is_active })
        .eq("id", location.id)
        .select()
        .single<StockLocation>();
      if (error || !data) {
        toastError("Location not updated", inventoryErrorMessage(error, "Could not update the location."));
        return;
      }
      dispatch(locationSaved(data));
      try {
        await audit("update", data, { before: location, after: data });
      } catch {
        // Best-effort: an audit failure must not turn a successful update into an error toast.
      }
      success(data.is_active ? "Location reactivated" : "Location deactivated", `“${data.name}”`);
    } catch {
      toastError("Location not updated", CONNECTION_ERROR);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      const supabase = await createTenantClient();
      const { data, error } = await supabase.from("stock_locations").delete().eq("id", target.id).select("id");
      if (error) {
        toastError("Delete failed", inventoryErrorMessage(error, "Could not delete the location."));
        return;
      }
      if (!data || data.length === 0) {
        toastError("Delete failed", "You don't have permission to delete this location, or it no longer exists.");
        return;
      }
      dispatch(locationRemoved(target.id));
      try {
        await audit("delete", target, { before: target, reason });
      } catch {
        // Best-effort: an audit failure must not turn a successful delete into an error toast.
      }
      success("Location deleted", `“${target.name}” has been removed.`);
      setDeleteTarget(null);
    } catch {
      // Keep deleteTarget set so the modal stays open (DeleteConfirmModal itself
      // clears its own "deleting" busy state once this promise resolves either way).
      toastError("Delete failed", CONNECTION_ERROR);
    }
  }

  const columns = [
    {
      header: "Location",
      sortValue: (l: StockLocation) => l.name.toLowerCase(),
      render: (l: StockLocation) => (
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-(--color-text-strong)">{l.name}</span>
          {settings?.default_location_id === l.id && <Badge label="Default" variant="info" />}
        </span>
      ),
    },
    {
      header: "Type",
      sortValue: (l: StockLocation) => LOCATION_TYPE_LABELS[l.type],
      render: (l: StockLocation) => <span className="text-sm text-(--color-text-base)">{LOCATION_TYPE_LABELS[l.type]}</span>,
    },
    {
      header: "Status",
      render: (l: StockLocation) =>
        l.is_active ? <Badge label="Active" variant="success" /> : <Badge label="Inactive" />,
    },
    ...(isAdmin
      ? [
          {
            header: "Actions",
            render: (l: StockLocation) => (
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEditTarget(l)} title="Edit" aria-label={`Edit ${l.name}`}>
                  <Pencil size={15} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleToggleActive(l)}
                  disabled={togglingId === l.id}
                  title={l.is_active ? "Deactivate" : "Reactivate"}
                  aria-label={`${l.is_active ? "Deactivate" : "Reactivate"} ${l.name}`}
                >
                  {l.is_active ? <Archive size={15} /> : <ArchiveRestore size={15} />}
                </Button>
                <Button
                  size="icon"
                  variant="danger"
                  onClick={() => setDeleteTarget(l)}
                  title="Delete"
                  aria-label={`Delete ${l.name}`}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div id="inventory-panel-locations" role="tabpanel" aria-labelledby="inventory-tab-locations" hidden={hidden} className="space-y-6">
      {!isAdmin && (
        <p className="text-sm text-(--color-text-muted)">Only admins can add or change locations.</p>
      )}
      <DataTable
        columns={columns}
        rows={sortLocations(locations)}
        keyField="id"
        emptyMessage="No locations yet — add your own warehouse, Amazon FBA or a 3PL."
      />

      <FulfillmentDefaultsCard key={defaultsKey} isAdmin={isAdmin} />

      <LocationModal
        key={editTarget?.id ?? (addOpen ? "new-location" : "closed")}
        open={addOpen || !!editTarget}
        location={editTarget}
        locations={locations}
        onClose={() => { setEditTarget(null); onAddClose(); }}
      />
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Location"
        description={`Delete “${deleteTarget?.name}”? A location that has ever held stock or fulfilled an order can't be deleted — deactivate it instead.`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
