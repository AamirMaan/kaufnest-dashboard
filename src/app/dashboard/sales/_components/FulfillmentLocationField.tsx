"use client";

import { useEffect, useState } from "react";
import { Field, Select } from "@/components/ui/FormFields";
import { Badge } from "@/components/ui/Badge";
import { useAdvancedInventory } from "@/app/dashboard/inventory/_store/useAdvancedInventory";
import { fetchStockByLocation } from "@/app/dashboard/inventory/_store/stockByLocation";
import { LOCATION_TYPE_LABELS, platformLocationOptions } from "@/app/dashboard/inventory/_lib/advancedInventory";
import { fulfillmentStockWarning, fulfillmentWarningText, suggestedFulfillmentLocationId } from "./fulfillmentLocation";
import type { Platform } from "@/types";

interface Props {
  productId: string;
  platform: Platform;
  quantity: number;
  /** "" until a location is suggested or picked. */
  value: string;
  /** true once the user picked a location (or the order already had one) — suggestions stop overwriting it. */
  touched: boolean;
  onChange: (locationId: string, touched: boolean) => void;
  disabled?: boolean;
  /**
   * Units this order already took from `value` (Edit of a saved order that
   * consumed stock there) — added back to the on-hand figure before comparing.
   */
  ownConsumption?: number;
  /** false when the order won't take stock (returned + restock) — no warning at all. */
  consumes?: boolean;
}

export function FulfillmentLocationField({
  productId, platform, quantity, value, touched, onChange, disabled, ownConsumption = 0, consumes = true,
}: Props) {
  const { locations, platformDefaults, settings } = useAdvancedInventory();
  // Keyed by the productId/value pair it was fetched for, so a stale result
  // from a since-superseded location/product can never be shown — derived
  // below instead of reset with a synchronous setState in the effect body.
  const [stock, setStock] = useState<{ key: string; available: number | null } | null>(null);

  // Follow the platform default until the user picks a location themselves.
  useEffect(() => {
    if (touched) return;
    const suggested = suggestedFulfillmentLocationId(platform, platformDefaults, locations, settings);
    if (suggested !== value) onChange(suggested, false);
  }, [platform, platformDefaults, locations, settings, touched, value, onChange]);

  // Units on hand at the chosen location, for the shortage warning.
  useEffect(() => {
    let cancelled = false;
    if (!productId || !value) return;
    const key = `${productId}:${value}`;
    fetchStockByLocation([productId])
      .then((rows) => {
        if (!cancelled) setStock({ key, available: rows.find((r) => r.location_id === value)?.qty ?? 0 });
      })
      .catch(() => {
        if (!cancelled) setStock({ key, available: null }); // warning is advisory; never block the form on it
      });
    return () => { cancelled = true; };
  }, [productId, value]);

  const available = stock && stock.key === `${productId}:${value}` ? stock.available : null;
  const location = locations.find((l) => l.id === value);
  const warning = consumes ? fulfillmentStockWarning(location, available, quantity, ownConsumption) : null;

  return (
    <Field label="Fulfilled from">
      <Select value={value} onChange={(e) => onChange(e.target.value, true)} disabled={disabled}>
        <option value="">Default location</option>
        {platformLocationOptions(locations, value || null).map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} · {LOCATION_TYPE_LABELS[l.type]}{l.is_active ? "" : " (inactive)"}
          </option>
        ))}
      </Select>
      {warning && location && (
        <div className="mt-1 flex items-start gap-2" role="status">
          <Badge label={warning.kind === "dropship" ? "Dropship" : "Low stock"} variant="warning" />
          <p className="text-xs text-(--color-text-muted)">{fulfillmentWarningText(warning, location.name)}</p>
        </div>
      )}
    </Field>
  );
}
