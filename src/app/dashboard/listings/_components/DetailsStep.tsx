// src/app/dashboard/listings/_components/DetailsStep.tsx
"use client";

import { Field, Input, Select, Row, Textarea } from "@/components/ui/FormFields";
import type { DraftFormState } from "../_lib/wizardValidation";
import type { Currency } from "@/types";

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
}

export function DetailsStep({ draft, setDraft }: Props) {
  return (
    <div className="space-y-4">
      <Field label="Title" required>
        <Input
          value={draft.title}
          onChange={(e) => setDraft({ title: e.target.value })}
          placeholder="e.g. Wireless Mouse, 2.4GHz, Black"
          maxLength={80}
        />
      </Field>

      <Field label="Description">
        <Textarea
          value={draft.description}
          onChange={(e) => setDraft({ description: e.target.value })}
          placeholder="Item details buyers will see on eBay"
        />
      </Field>

      <Row>
        <Field label="Price" required>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={draft.price}
            onChange={(e) => setDraft({ price: e.target.value })}
          />
        </Field>
        <Field label="Currency">
          <Select
            value={draft.currency}
            onChange={(e) => setDraft({ currency: e.target.value as Currency })}
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
          </Select>
        </Field>
      </Row>

      <Row>
        <Field label="Quantity" required>
          <Input
            type="number"
            min="1"
            step="1"
            value={draft.quantity}
            onChange={(e) => setDraft({ quantity: e.target.value })}
          />
        </Field>
        <Field label="Condition" required>
          <Select
            value={draft.condition}
            onChange={(e) => setDraft({ condition: e.target.value as DraftFormState["condition"] })}
          >
            <option value="new">New</option>
            <option value="used">Used</option>
            <option value="refurbished">Refurbished</option>
          </Select>
        </Field>
      </Row>
    </div>
  );
}
