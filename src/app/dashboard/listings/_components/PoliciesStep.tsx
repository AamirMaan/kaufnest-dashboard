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

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
}

export function PoliciesStep({ draft, setDraft }: Props) {
  const [policies, setPolicies] = useState<BusinessPolicies | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/listings/ebay/policies");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load business policies");
        setPolicies(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load business policies");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p className="text-sm text-(--color-text-muted)">Loading business policies…</p>;
  if (error) return <p className="text-sm text-(--color-danger-text)">{error}</p>;
  if (!policies) return null;

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
    </div>
  );
}
