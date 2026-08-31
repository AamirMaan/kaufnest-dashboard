"use client";

import { useEffect, useState } from "react";
import { Field, Select, Input } from "@/components/ui/FormFields";
import type { DraftFormState } from "../_lib/wizardValidation";

interface RequiredAspect {
  name: string;
  values: string[];
}

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
}

export function AspectsStep({ draft, setDraft }: Props) {
  const [required, setRequired] = useState<RequiredAspect[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Deferred via a microtask so every branch's setState — including the
    // no-category early return — runs after this tick, not synchronously
    // within the effect body (trips react-hooks/set-state-in-effect
    // otherwise; same pattern as welcome/page.tsx).
    Promise.resolve().then(async () => {
      if (!draft.category_id) {
        setRequired([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `/api/listings/ebay/aspects?categoryId=${encodeURIComponent(draft.category_id)}`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load required item details");
        setRequired(json.aspects);
        setDraft({ required_aspect_names: json.aspects.map((a: RequiredAspect) => a.name) });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load required item details");
      } finally {
        setLoading(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.category_id]);

  if (loading) return <p className="text-sm text-(--color-text-muted)">Loading required item details…</p>;
  if (error) return <p className="text-sm text-(--color-danger-text)">{error}</p>;
  if (!required) return null;

  if (required.length === 0) {
    return (
      <p className="text-sm text-(--color-text-muted)">
        No additional item details are required for this category.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-(--color-text-muted)">
        eBay requires these details for the category you selected.
      </p>
      {required.map((aspect) => (
        <Field key={aspect.name} label={aspect.name} required>
          {aspect.values.length > 0 ? (
            <Select
              value={draft.aspects[aspect.name] ?? ""}
              onChange={(e) =>
                setDraft({ aspects: { ...draft.aspects, [aspect.name]: e.target.value } })
              }
            >
              <option value="">Select…</option>
              {aspect.values.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </Select>
          ) : (
            <Input
              value={draft.aspects[aspect.name] ?? ""}
              onChange={(e) =>
                setDraft({ aspects: { ...draft.aspects, [aspect.name]: e.target.value } })
              }
            />
          )}
        </Field>
      ))}
    </div>
  );
}
