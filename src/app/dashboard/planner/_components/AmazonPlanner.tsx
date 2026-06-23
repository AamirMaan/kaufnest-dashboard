"use client";

import { useMemo, useState } from "react";
import { calcAmazonResult } from "../_lib/calculations";
import type { VatMode, FulfillmentMethod } from "../_lib/calculations";
import { AMAZON_CATEGORIES } from "../_lib/fees";
import { PlannerResults } from "./PlannerResults";

interface FormState {
  sellingPrice: string;
  vatMode: VatMode;
  vatRate: string;
  purchaseCost: string;
  categoryLabel: string;
  customReferralRate: string;
  fulfillmentMethod: FulfillmentMethod;
  fbaFulfillmentFee: string;
  fbaStorageFee: string;
  shippingCost: string;
  advertisingRate: string;
}

const DEFAULT_FORM: FormState = {
  sellingPrice: "",
  vatMode: "inclusive",
  vatRate: "20",
  purchaseCost: "",
  categoryLabel: AMAZON_CATEGORIES[0].label,
  customReferralRate: "",
  fulfillmentMethod: "fba",
  fbaFulfillmentFee: "",
  fbaStorageFee: "",
  shippingCost: "",
  advertisingRate: "",
};

function parse(v: string, fallback = 0): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function AmazonPlanner() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);

  const set =
    (field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const isCustom = form.categoryLabel === "custom";
  const isFba = form.fulfillmentMethod === "fba";

  const result = useMemo(() => {
    const sp = parse(form.sellingPrice);
    const pc = parse(form.purchaseCost);
    if (!sp || !pc) return null;
    const referralFeeRate =
      form.categoryLabel === "custom"
        ? parse(form.customReferralRate) / 100
        : (AMAZON_CATEGORIES.find((c) => c.label === form.categoryLabel)?.referralFeeRate ?? 0.15);
    return calcAmazonResult({
      sellingPrice: sp,
      vatMode: form.vatMode,
      vatRate: parse(form.vatRate, 20) / 100,
      purchaseCost: pc,
      referralFeeRate,
      fulfillmentMethod: form.fulfillmentMethod,
      fbaFulfillmentFee: parse(form.fbaFulfillmentFee),
      fbaStorageFee: parse(form.fbaStorageFee),
      shippingCost: parse(form.shippingCost),
      advertisingRate: parse(form.advertisingRate) / 100,
    });
  }, [form]);

  const shippingLabel = isFba ? "FBA fees" : "Shipping";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
        <PlannerField label="Selling price (€)" id="amz-sp">
          <input
            id="amz-sp"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.sellingPrice}
            onChange={set("sellingPrice")}
            className={inputCls}
          />
        </PlannerField>

        <PlannerField label="VAT mode" id="amz-vatMode">
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
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-sidebar-hover)]",
                ].join(" ")}
              >
                {mode}
              </button>
            ))}
          </div>
        </PlannerField>

        <PlannerField label="VAT rate (%)" id="amz-vatRate">
          <input
            id="amz-vatRate"
            type="number"
            min="0"
            max="100"
            step="1"
            value={form.vatRate}
            onChange={set("vatRate")}
            className={inputCls}
          />
        </PlannerField>

        <PlannerField label="Purchase / cost price (€)" id="amz-pc">
          <input
            id="amz-pc"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.purchaseCost}
            onChange={set("purchaseCost")}
            className={inputCls}
          />
        </PlannerField>

        <PlannerField label="Amazon category (Referral fee)" id="amz-cat">
          <select
            id="amz-cat"
            value={form.categoryLabel}
            onChange={set("categoryLabel")}
            className={inputCls}
          >
            {AMAZON_CATEGORIES.map((c) => (
              <option key={c.label} value={c.label}>
                {c.label} ({(c.referralFeeRate * 100).toFixed(0)} %)
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </PlannerField>

        {isCustom && (
          <PlannerField label="Custom referral rate (%)" id="amz-customRef">
            <input
              id="amz-customRef"
              type="number"
              min="0"
              max="100"
              step="0.1"
              placeholder="0.0"
              value={form.customReferralRate}
              onChange={set("customReferralRate")}
              className={inputCls}
            />
          </PlannerField>
        )}

        <PlannerField label="Fulfillment method" id="amz-fulfillment">
          <div className="flex rounded-[var(--radius-btn)] border border-[var(--color-border)] overflow-hidden text-sm">
            {(["fba", "fbm"] as FulfillmentMethod[]).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setForm((p) => ({ ...p, fulfillmentMethod: method }))}
                className={[
                  "flex-1 py-1.5 font-medium transition-colors uppercase cursor-pointer",
                  form.fulfillmentMethod === method
                    ? "bg-[var(--color-sidebar-active)] text-white"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-sidebar-hover)]",
                ].join(" ")}
              >
                {method}
              </button>
            ))}
          </div>
        </PlannerField>

        {isFba && (
          <>
            <PlannerField label="FBA fulfillment fee (€)" id="amz-fbaFulfil">
              <input
                id="amz-fbaFulfil"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.fbaFulfillmentFee}
                onChange={set("fbaFulfillmentFee")}
                className={inputCls}
              />
            </PlannerField>
            <PlannerField label="FBA storage fee (€ / unit / month)" id="amz-fbaStorage">
              <input
                id="amz-fbaStorage"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.fbaStorageFee}
                onChange={set("fbaStorageFee")}
                className={inputCls}
              />
            </PlannerField>
          </>
        )}

        {!isFba && (
          <PlannerField label="Shipping cost (€)" id="amz-shipping">
            <input
              id="amz-shipping"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.shippingCost}
              onChange={set("shippingCost")}
              className={inputCls}
            />
          </PlannerField>
        )}

        <PlannerField label="Advertising (%)" id="amz-ads">
          <input
            id="amz-ads"
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
      </div>

      <PlannerResults result={result} vatMode={form.vatMode} shippingLabel={shippingLabel} />
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
