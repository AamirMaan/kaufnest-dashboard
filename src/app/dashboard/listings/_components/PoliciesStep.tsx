"use client";

import { useEffect, useState } from "react";
import { Field, Select } from "@/components/ui/FormFields";
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

export function PoliciesStep({ draft, setDraft }: Props) {
  const [policies, setPolicies] = useState<BusinessPolicies | null>(null);
  const [locations, setLocations] = useState<InventoryLocation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

      <Field label="Inventory Location" required>
        {locations.length === 0 ? (
          <p className="text-sm text-(--color-danger-text)">
            No usable inventory location found in your eBay account. Create one with a
            complete address (including country) in Seller Hub, then come back to this step.
          </p>
        ) : (
          <Select
            value={draft.merchant_location_key}
            onChange={(e) => setDraft({ merchant_location_key: e.target.value })}
          >
            <option value="">Select…</option>
            {locations.map((loc) => (
              <option key={loc.key} value={loc.key}>{loc.name}</option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
