"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Field, Input, Row, Select } from "@/components/ui/FormFields";
import { LOCATION_TYPE_LABELS, platformLocationOptions } from "@/app/dashboard/inventory/_lib/advancedInventory";
import { landedUnitCost } from "@/app/dashboard/inventory/_lib/landedCost";
import { hasLandedCosts, parseLandedPreview, type PurchaseInventoryFieldsState } from "../_lib/purchaseInventoryFields";
import type { Currency, StockLocation } from "@/types";

interface Props {
  value: PurchaseInventoryFieldsState;
  onChange: (next: PurchaseInventoryFieldsState) => void;
  locations: StockLocation[];
  defaultLocationName: string | null;
  quantity: number;
  totalAmount: number;
  vatAmount: number;
  currency: Currency;
  disabled?: boolean;
}

export function PurchaseInventoryFields({
  value, onChange, locations, defaultLocationName, quantity, totalAmount, vatAmount, currency, disabled,
}: Props) {
  const [open, setOpen] = useState(() => hasLandedCosts(value));
  const set = (key: keyof PurchaseInventoryFieldsState, v: string) => onChange({ ...value, [key]: v });
  const preview = landedUnitCost({
    totalAmount,
    vatAmount,
    quantity,
    freightCost: parseLandedPreview(value.freight),
    customsCost: parseLandedPreview(value.customs),
    otherCost: parseLandedPreview(value.other),
  });

  return (
    <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border)] p-4">
      <Field label="Location">
        <Select value={value.locationId} onChange={(e) => set("locationId", e.target.value)} disabled={disabled}>
          <option value="">Default location{defaultLocationName ? ` (${defaultLocationName})` : ""}</option>
          {platformLocationOptions(locations, value.locationId || null).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} · {LOCATION_TYPE_LABELS[l.type]}{l.is_active ? "" : " (inactive)"}
            </option>
          ))}
        </Select>
      </Field>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 text-sm font-medium text-[var(--color-text-strong)]"
      >
        {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />} Landed costs
      </button>

      {open && (
        <>
          <Row>
            <Field label="Freight">
              <Input type="number" min="0" step="0.01" value={value.freight} onChange={(e) => set("freight", e.target.value)} placeholder="0.00" disabled={disabled} />
            </Field>
            <Field label="Customs / duty">
              <Input type="number" min="0" step="0.01" value={value.customs} onChange={(e) => set("customs", e.target.value)} placeholder="0.00" disabled={disabled} />
            </Field>
          </Row>
          <Field label="Other costs">
            <Input type="number" min="0" step="0.01" value={value.other} onChange={(e) => set("other", e.target.value)} placeholder="0.00" disabled={disabled} />
          </Field>
        </>
      )}

      {preview !== null && totalAmount > 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Landed cost per unit (excl. VAT): <span className="font-semibold text-[var(--color-text-strong)]">{currency} {preview.toFixed(2)}</span>
        </p>
      )}
    </div>
  );
}
