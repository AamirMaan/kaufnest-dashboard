// src/app/dashboard/listings/_components/SourceStep.tsx
"use client";

import { Field, Input, Select } from "@/components/ui/FormFields";
import { useAppSelector } from "@/store/hooks";
import { detectPlatform } from "@/lib/utils/detectPlatform";
import type { DraftFormState } from "../_lib/wizardValidation";

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
}

export function SourceStep({ draft, setDraft }: Props) {
  const products = useAppSelector((s) => s.inventory.selectorItems);
  const detected = draft.source_url ? detectPlatform(draft.source_url) : null;

  return (
    <div className="space-y-4">
      <Field label="Source" required>
        <Select
          value={draft.source_type}
          onChange={(e) =>
            setDraft({
              source_type: e.target.value as DraftFormState["source_type"],
              product_id: "",
              source_url: "",
            })
          }
        >
          <option value="inventory">Inventory product</option>
          <option value="dropship">Third-party (dropship) source</option>
        </Select>
      </Field>

      {draft.source_type === "inventory" ? (
        <Field label="Inventory Product" required>
          <Select
            required
            value={draft.product_id}
            onChange={(e) => setDraft({ product_id: e.target.value })}
          >
            <option value="">Select a product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.sku ? `(${p.sku})` : ""}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="Supplier URL" required>
          <Input
            required
            type="url"
            value={draft.source_url}
            onChange={(e) => setDraft({ source_url: e.target.value })}
            placeholder="https://de.aliexpress.com/item/…"
          />
          {detected && (
            <p className="mt-1 text-xs text-(--color-text-muted)">Detected: {detected}</p>
          )}
        </Field>
      )}
    </div>
  );
}
