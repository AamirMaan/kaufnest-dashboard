"use client";

import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { Button } from "@/components/ui/Button";
import { Field, Row, Select } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";
import { platformDefaultsMerged, settingsSet } from "../_store/advancedInventorySlice";
import {
  INVENTORY_PLATFORMS,
  LOCATION_TYPE_LABELS,
  PLATFORM_LABELS,
  defaultLocationOptions,
  fulfillmentDraftFrom,
  isFulfillmentDraftDirty,
  isFulfillmentDraftValid,
  platformDefaultChanges,
  platformLocationOptions,
  type FulfillmentDraft,
} from "../_lib/advancedInventory";
import type { Platform, PlatformLocationDefault } from "@/types";

const FORM_ID = "fulfillment-defaults-form";
const CONNECTION_ERROR = "Please check your connection and try again.";

interface Props {
  isAdmin: boolean;
}

export function FulfillmentDefaultsCard({ isAdmin }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const settings = useAppSelector((s) => s.advancedInventory.settings);
  const locations = useAppSelector((s) => s.advancedInventory.locations);
  const platformDefaults = useAppSelector((s) => s.advancedInventory.platformDefaults);

  const [draft, setDraft] = useState<FulfillmentDraft>(() => fulfillmentDraftFrom(settings, platformDefaults));
  const [saving, setSaving] = useState(false);

  const isFormValid = isFulfillmentDraftValid(draft, locations);
  const isDirty = isFulfillmentDraftDirty(settings, platformDefaults, draft);

  function setPlatform(platform: Platform, locationId: string) {
    setDraft((d) => ({ ...d, platforms: { ...d.platforms, [platform]: locationId } }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!settings || !isFormValid || !isDirty) return;
    setSaving(true);
    try {
      const supabase = await createTenantClient();
      const before = { defaultLocationId: settings.default_location_id, platformDefaults };

      // Both writes' store dispatches are deferred until the whole submit
      // settles (see the block at the bottom) — dispatching right after each
      // write changes `defaultsKey` in LocationsTab mid-submit, remounting
      // this card while a later write is still in flight (`saving` drops
      // back to `false`, unsaved platform edits vanish, a second Save
      // becomes clickable).
      let savedDefaultId: string | null = null;
      if (draft.defaultLocationId !== settings.default_location_id) {
        const { error } = await supabase.rpc("set_default_location", { p_location_id: draft.defaultLocationId });
        if (error) {
          toastError("Defaults not saved", inventoryErrorMessage(error, "Could not change the default location."));
          return;
        }
        savedDefaultId = draft.defaultLocationId;
      }

      const changes = platformDefaultChanges(platformDefaults, draft);
      let savedChanges: PlatformLocationDefault[] | null = null;
      if (changes.length > 0) {
        const { error } = await supabase.from("platform_location_defaults").upsert(changes, { onConflict: "platform" });
        if (error) {
          // Partial-success honesty: the RPC above may already have
          // committed in the database even though its dispatch was held
          // back — dispatch it now so the store matches what was actually
          // saved, then tell the user only the platform defaults failed.
          if (savedDefaultId !== null) {
            dispatch(settingsSet({ ...settings, default_location_id: savedDefaultId }));
          }
          toastError(
            savedDefaultId !== null ? "Platform defaults not saved" : "Defaults not saved",
            savedDefaultId !== null
              ? inventoryErrorMessage(error, "The default location was saved, but the platform defaults could not be saved — please re-select and save again.")
              : inventoryErrorMessage(error, "Could not save the platform defaults.")
          );
          return;
        }
        savedChanges = changes;
      }

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const log = await writeAuditLog(supabase, {
            userId: user.id,
            userEmail: user.email ?? "",
            action: "update",
            entityType: "inventory_settings",
            metadata: { event: "fulfillment_defaults_changed", before, after: draft },
          });
          if (log) dispatch(addAuditLog(log));
        }
      } catch {
        // Best-effort: an audit failure must not turn a successful save into an error toast.
      }

      // Full success: dispatch both writes now, after everything (including
      // the audit log) has finished. LocationsTab's `defaultsKey` changes
      // here, remounting this card with the saved values — the intended
      // reset, now happening only once the save is actually done.
      if (savedDefaultId !== null) dispatch(settingsSet({ ...settings, default_location_id: savedDefaultId }));
      if (savedChanges) dispatch(platformDefaultsMerged(savedChanges));
      success("Fulfillment defaults saved", "New orders will use these locations.");
    } catch {
      toastError("Defaults not saved", CONNECTION_ERROR);
    } finally {
      setSaving(false);
    }
  }

  const optionLabel = (id: string) => {
    const l = locations.find((x) => x.id === id);
    return l ? `${l.name} · ${LOCATION_TYPE_LABELS[l.type]}${l.is_active ? "" : " (inactive)"}` : "";
  };

  return (
    <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6">
      <h2 className="text-base font-semibold text-(--color-text-strong)">Fulfillment defaults</h2>
      <p className="mt-1 text-sm text-(--color-text-muted)">
        Where new orders ship from when no location is chosen — including orders synced from eBay and Amazon.
        You can still change the location on any order.
      </p>

      <form id={FORM_ID} onSubmit={handleSubmit} className="mt-4 space-y-4">
        <Field label="Default location" required>
          <Select
            value={draft.defaultLocationId}
            onChange={(e) => setDraft((d) => ({ ...d, defaultLocationId: e.target.value }))}
            disabled={!isAdmin || saving}
            required
          >
            <option value="" disabled>Choose a location</option>
            {defaultLocationOptions(locations).map((l) => (
              <option key={l.id} value={l.id}>{optionLabel(l.id)}</option>
            ))}
          </Select>
        </Field>

        <Row>
          {INVENTORY_PLATFORMS.map((platform) => (
            <Field key={platform} label={PLATFORM_LABELS[platform]} required>
              <Select
                value={draft.platforms[platform]}
                onChange={(e) => setPlatform(platform, e.target.value)}
                disabled={!isAdmin || saving}
                required
              >
                <option value="" disabled>Choose a location</option>
                {platformLocationOptions(locations, draft.platforms[platform] || null).map((l) => (
                  <option key={l.id} value={l.id}>{optionLabel(l.id)}</option>
                ))}
              </Select>
            </Field>
          ))}
        </Row>

        {isAdmin && (
          <div className="flex justify-end">
            <Button type="submit" form={FORM_ID} variant="secondary" disabled={saving || !isFormValid || !isDirty}>
              {saving ? "Saving…" : "Save defaults"}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}
