"use client";

import { useMemo, useState } from "react";
import { calcEbayResult } from "../_lib/calculations";
import type { VatMode } from "../_lib/calculations";
import { EBAY_CATEGORIES } from "../_lib/fees";
import { PlannerResults } from "./PlannerResults";

type ChargeType = "pct" | "fixed";

interface FormState {
  sellingPrice: string;
  vatMode: VatMode;
  vatRate: string;
  purchaseCost: string;
  categoryLabel: string;
  customFvfRate: string;
  shippingCost: string;
  advertisingRate: string;
  customChargeLabel: string;
  customChargeType: ChargeType;
  customChargeValue: string;
}

const DEFAULT_FORM: FormState = {
  sellingPrice: "",
  vatMode: "inclusive",
  vatRate: "20",
  purchaseCost: "",
  categoryLabel: EBAY_CATEGORIES[0].label,
  customFvfRate: "",
  shippingCost: "",
  advertisingRate: "",
  customChargeLabel: "",
  customChargeType: "pct",
  customChargeValue: "",
};

function parse(v: string, fallback = 0): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function EbayPlanner() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);

  const set =
    (field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const isCustom = form.categoryLabel === "custom";

  const result = useMemo(() => {
    const sp = parse(form.sellingPrice);
    const pc = parse(form.purchaseCost);
    if (!sp || !pc) return null;
    const category = form.categoryLabel === "custom"
      ? { fvfRate: parse(form.customFvfRate) / 100, flatFee: 0.30 }
      : (EBAY_CATEGORIES.find((c) => c.label === form.categoryLabel) ?? EBAY_CATEGORIES[0]);
    const customChargeRate  = form.customChargeType === "pct"   ? parse(form.customChargeValue) / 100 : 0;
    const customChargeFixed = form.customChargeType === "fixed" ? parse(form.customChargeValue) : 0;
    return calcEbayResult({
      sellingPrice: sp,
      vatMode: form.vatMode,
      vatRate: parse(form.vatRate, 20) / 100,
      purchaseCost: pc,
      fvfRate: category.fvfRate,
      fvfFlatFee: category.flatFee,
      shippingCost: parse(form.shippingCost),
      advertisingRate: parse(form.advertisingRate) / 100,
      customChargeRate,
      customChargeFixed,
    });
  }, [form]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
        <PlannerField label="Selling price (€)" id="ebay-sp">
          <input
            id="ebay-sp"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.sellingPrice}
            onChange={set("sellingPrice")}
            className={inputCls}
          />
        </PlannerField>

        <PlannerField label="VAT mode" id="ebay-vatMode">
          <div className="flex rounded-[var(--radius-btn)] border border-[var(--color-border)] overflow-hidden text-sm">
            {(["inclusive", "exclusive"] as VatMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setForm((p) => ({ ...p, vatMode: mode }))}
                className={[
                  "flex-1 py-1.5 font-medium transition-colors capitalize cursor-pointer",
                  form.vatMode === mode
                    ? "bg-[var(--color-sidebar-active)] text-white"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)]",
                ].join(" ")}
              >
                {mode}
              </button>
            ))}
          </div>
        </PlannerField>

        <PlannerField label="VAT rate (%)" id="ebay-vatRate">
          <input
            id="ebay-vatRate"
            type="number"
            min="0"
            max="100"
            step="1"
            value={form.vatRate}
            onChange={set("vatRate")}
            className={inputCls}
          />
        </PlannerField>

        <PlannerField label="Purchase / cost price (€)" id="ebay-pc">
          <input
            id="ebay-pc"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.purchaseCost}
            onChange={set("purchaseCost")}
            className={inputCls}
          />
        </PlannerField>

        <PlannerField label="eBay category (Final Value Fee)" id="ebay-cat">
          <select
            id="ebay-cat"
            value={form.categoryLabel}
            onChange={set("categoryLabel")}
            className={inputCls}
          >
            {EBAY_CATEGORIES.map((c) => (
              <option key={c.label} value={c.label}>
                {c.label} ({(c.fvfRate * 100).toFixed(1)} %)
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </PlannerField>

        {isCustom && (
          <PlannerField label="Custom FVF rate (%)" id="ebay-customFvf">
            <input
              id="ebay-customFvf"
              type="number"
              min="0"
              max="100"
              step="0.1"
              placeholder="0.0"
              value={form.customFvfRate}
              onChange={set("customFvfRate")}
              className={inputCls}
            />
          </PlannerField>
        )}

        <PlannerField label="Shipping / postage cost (€)" id="ebay-shipping">
          <input
            id="ebay-shipping"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.shippingCost}
            onChange={set("shippingCost")}
            className={inputCls}
          />
        </PlannerField>

        <PlannerField label="Advertising / promoted listings (%)" id="ebay-ads">
          <input
            id="ebay-ads"
            type="number"
            min="0"
            max="100"
            step="0.1"
            placeholder="0.0"
            value={form.advertisingRate}
            onChange={set("advertisingRate")}
            className={inputCls}
          />
        </PlannerField>

        {/* Custom charge */}
        <div className="space-y-1">
          <span className="block text-xs font-medium text-[var(--color-text-muted)]">
            Additional charge (optional)
          </span>
          <input
            type="text"
            placeholder="Label, e.g. PayPal fee, Import duty…"
            value={form.customChargeLabel}
            onChange={set("customChargeLabel")}
            className={inputCls}
          />
          <div className="flex gap-2 pt-1">
            <div className="flex rounded-[var(--radius-btn)] border border-[var(--color-border)] overflow-hidden text-sm shrink-0">
              {(["pct", "fixed"] as ChargeType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, customChargeType: type }))}
                  className={[
                    "w-9 py-1.5 font-medium transition-colors cursor-pointer",
                    form.customChargeType === type
                      ? "bg-[var(--color-sidebar-active)] text-white"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)]",
                  ].join(" ")}
                >
                  {type === "pct" ? "%" : "€"}
                </button>
              ))}
            </div>
            <input
              type="number"
              min="0"
              step={form.customChargeType === "pct" ? "0.1" : "0.01"}
              placeholder={form.customChargeType === "pct" ? "0.0" : "0.00"}
              value={form.customChargeValue}
              onChange={set("customChargeValue")}
              className={inputCls}
            />
          </div>
        </div>
      </div>

      <PlannerResults
        result={result}
        vatMode={form.vatMode}
        shippingLabel="Shipping"
        customChargeLabel={form.customChargeLabel || undefined}
      />
    </div>
  );
}

function PlannerField({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-[var(--color-text-muted)]">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent";
