"use client";

import { useEffect, useState } from "react";
import { Field, Select, Input } from "@/components/ui/FormFields";
import { Button } from "@/components/ui/Button";
import type { DraftFormState } from "../_lib/wizardValidation";

interface PolicySummary {
  id: string;
  name: string;
}
interface BusinessPolicies {
  fulfillment: PolicySummary[];
  payment: PolicySummary[];
  return: PolicySummary[];
}
interface InventoryLocation {
  key: string;
  name: string;
  hasCountry: boolean;
}

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
}

const EMPTY_NEW_LOCATION = {
  name: "",
  addressLine1: "",
  city: "",
  stateOrProvince: "",
  postalCode: "",
  country: "",
};

export function PoliciesStep({ draft, setDraft }: Props) {
  const [policies, setPolicies] = useState<BusinessPolicies | null>(null);
  const [locations, setLocations] = useState<InventoryLocation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newLocation, setNewLocation] = useState(EMPTY_NEW_LOCATION);
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [policiesRes, locationsRes] = await Promise.all([
          fetch("/api/listings/ebay/policies"),
          fetch("/api/listings/ebay/locations"),
        ]);
        const policiesJson = await policiesRes.json();
        if (!policiesRes.ok) throw new Error(policiesJson.error ?? "Failed to load business policies");
        setPolicies(policiesJson);

        const locationsJson = await locationsRes.json();
        if (!locationsRes.ok) throw new Error(locationsJson.error ?? "Failed to load inventory locations");
        const usable: InventoryLocation[] = (locationsJson.locations ?? []).filter(
          (loc: InventoryLocation) => loc.hasCountry
        );
        setLocations(usable);
        // Auto-select when there's exactly one usable location — the common
        // case for a small seller — instead of forcing an extra click.
        if (usable.length === 1 && !draft.merchant_location_key) {
          setDraft({ merchant_location_key: usable[0].key });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load business policies");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateLocation() {
    setCreateError(null);
    setCreatingLocation(true);
    try {
      const res = await fetch("/api/listings/ebay/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newLocation),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create inventory location");
      const created: InventoryLocation = json.location;
      setLocations((prev) => [...(prev ?? []), created]);
      setDraft({ merchant_location_key: created.key });
      setNewLocation(EMPTY_NEW_LOCATION);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create inventory location");
    } finally {
      setCreatingLocation(false);
    }
  }

  if (loading) return <p className="text-sm text-(--color-text-muted)">Loading business policies…</p>;
  if (error) return <p className="text-sm text-(--color-danger-text)">{error}</p>;
  if (!policies || !locations) return null;

  return (
    <div className="space-y-4">
      <Field label="Fulfillment Policy" required>
        <Select
          value={draft.fulfillment_policy_id}
          onChange={(e) => setDraft({ fulfillment_policy_id: e.target.value })}
        >
          <option value="">Select…</option>
          {policies.fulfillment.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </Field>

      <Field label="Payment Policy" required>
        <Select
          value={draft.payment_policy_id}
          onChange={(e) => setDraft({ payment_policy_id: e.target.value })}
        >
          <option value="">Select…</option>
          {policies.payment.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </Field>

      <Field label="Return Policy" required>
        <Select
          value={draft.return_policy_id}
          onChange={(e) => setDraft({ return_policy_id: e.target.value })}
        >
          <option value="">Select…</option>
          {policies.return.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </Field>

      {locations.length === 0 ? (
        <div className="space-y-3 rounded-(--radius-btn) border border-(--color-border) p-4">
          <p className="text-sm text-(--color-text-muted)">
            No inventory location found in your eBay account yet. Create one below — it
            will be used as the ship-from address on your listings.
          </p>
          {createError && <p className="text-sm text-(--color-danger-text)">{createError}</p>}

          <Field label="Location Name" required>
            <Input
              value={newLocation.name}
              onChange={(e) => setNewLocation((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Main Warehouse"
            />
          </Field>
          <Field label="City" required>
            <Input
              value={newLocation.city}
              onChange={(e) => setNewLocation((prev) => ({ ...prev, city: e.target.value }))}
              placeholder="Berlin"
            />
          </Field>
          <Field label="State / Province">
            <Input
              value={newLocation.stateOrProvince}
              onChange={(e) =>
                setNewLocation((prev) => ({ ...prev, stateOrProvince: e.target.value }))
              }
              placeholder="Optional"
            />
          </Field>
          <Field label="Postal Code" required>
            <Input
              value={newLocation.postalCode}
              onChange={(e) =>
                setNewLocation((prev) => ({ ...prev, postalCode: e.target.value }))
              }
              placeholder="10115"
            />
          </Field>
          <Field label="Country" required>
            <Input
              value={newLocation.country}
              onChange={(e) =>
                setNewLocation((prev) => ({ ...prev, country: e.target.value.toUpperCase() }))
              }
              placeholder="DE"
              maxLength={2}
            />
          </Field>

          <Button
            type="button"
            variant="secondary"
            onClick={handleCreateLocation}
            disabled={
              creatingLocation ||
              !newLocation.name.trim() ||
              !newLocation.city.trim() ||
              !newLocation.postalCode.trim() ||
              !/^[A-Z]{2}$/.test(newLocation.country)
            }
          >
            {creatingLocation ? "Creating…" : "Create location"}
          </Button>
        </div>
      ) : (
        <Field label="Inventory Location" required>
          <Select
            value={draft.merchant_location_key}
            onChange={(e) => setDraft({ merchant_location_key: e.target.value })}
          >
            <option value="">Select…</option>
            {locations.map((loc) => (
              <option key={loc.key} value={loc.key}>{loc.name}</option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  );
}
