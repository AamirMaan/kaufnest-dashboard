"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch } from "@/store/hooks";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { locationSaved } from "../_store/advancedInventorySlice";
import { LOCATION_TYPES, LOCATION_TYPE_LABELS, isLocationNameTaken } from "../_lib/advancedInventory";
import type { StockLocation, StockLocationType } from "@/types";

interface Props {
  open: boolean;
  /** null = add a new location. */
  location: StockLocation | null;
  locations: StockLocation[];
  onClose: () => void;
}

const FORM_ID = "location-form";

export function LocationModal({ open, location, locations, onClose }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const [name, setName] = useState(location?.name ?? "");
  const [type, setType] = useState<StockLocationType>(location?.type ?? "own");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameTaken = name.trim() !== "" && isLocationNameTaken(name, locations, location?.id);
  const isFormValid = name.trim() !== "" && !nameTaken;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid) return;
    setSaving(true);
    setError(null);

    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();
    const values = { name: name.trim(), type };

    const { data, error: dbError } = location
      ? await supabase.from("stock_locations").update(values).eq("id", location.id).select().single<StockLocation>()
      : await supabase
          .from("stock_locations")
          .insert({ ...values, created_by: user?.id ?? null })
          .select()
          .single<StockLocation>();

    if (dbError || !data) {
      const message =
        dbError?.code === "23505"
          ? "A location with this name already exists."
          : inventoryErrorMessage(dbError, "Could not save the location.");
      setError(message);
      toastError("Location not saved", message);
      setSaving(false);
      return;
    }

    dispatch(locationSaved(data));
    if (user) {
      const log = await writeAuditLog(supabase, {
        userId: user.id,
        userEmail: user.email ?? "",
        action: location ? "update" : "create",
        entityType: "stock_location",
        entityId: data.id,
        metadata: location ? { before: location, after: data } : { name: data.name, type: data.type },
      });
      if (log) dispatch(addAuditLog(log));
    }
    success(location ? "Location updated" : "Location added", `“${data.name}” was saved.`);
    setSaving(false);
    onClose();
  }

  return (
    <Modal
      title={location ? "Edit Location" : "Add Location"}
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={saving || !isFormValid}>
            {saving ? "Saving…" : location ? "Save Changes" : "Add Location"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-(--radius-btn) border border-red-200 bg-(--color-danger-bg) px-4 py-3 text-sm text-(--color-danger-text)">
            {error}
          </div>
        )}
        <Field label="Name" required error={nameTaken ? "A location with this name already exists." : undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amazon FBA DE" required />
        </Field>
        <Field label="Type" required>
          <Select value={type} onChange={(e) => setType(e.target.value as StockLocationType)} required>
            {LOCATION_TYPES.map((t) => (
              <option key={t} value={t}>{LOCATION_TYPE_LABELS[t]}</option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-(--color-text-muted)">
          Dropship suppliers never hold stock: orders fulfilled from them use the linked purchase as their cost.
        </p>
      </form>
    </Modal>
  );
}
