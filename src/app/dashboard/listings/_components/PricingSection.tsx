"use client";

import { Lightbulb } from "lucide-react";
import { Field, Input, Select, Row, Checkbox } from "@/components/ui/FormFields";
import { MULTIBUY_PERCENT_OPTIONS, type DraftFormState } from "../_lib/wizardValidation";
import { MarketingReconnectNotice } from "./MarketingReconnectNotice";
import type { MarketingAccess } from "./useEbayCampaigns";
import type { Currency } from "@/types";

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
  access: MarketingAccess;
}

function TierSelect({
  label,
  value,
  required,
  onChange,
}: {
  label: string;
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} required={required}>
      <Select required={required} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{required ? "Select…" : "None"}</option>
        {MULTIBUY_PERCENT_OPTIONS.map((pct) => (
          <option key={pct} value={String(pct)}>
            {pct}%
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function PricingSection({ draft, setDraft, access }: Props) {
  return (
    <>
      <Row>
        <Field label="Price" required>
          <Input
            required
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
            required
            type="number"
            min="1"
            step="1"
            value={draft.quantity}
            onChange={(e) => setDraft({ quantity: e.target.value })}
          />
        </Field>
        <Field label="VAT % (if applicable)">
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={draft.vat_percentage}
            onChange={(e) => setDraft({ vat_percentage: e.target.value })}
          />
          <p className="mt-1 text-xs text-(--color-text-faint)">Included in the price.</p>
        </Field>
      </Row>

      <div className="space-y-3">
        <Checkbox
          label="Allow Best Offer — buyers can send you a price offer"
          checked={draft.best_offer_enabled}
          onChange={(e) => setDraft({ best_offer_enabled: e.target.checked })}
        />
        {draft.best_offer_enabled && (
          <Row>
            <Field label="Auto-accept offers at or above">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={draft.best_offer_auto_accept}
                onChange={(e) => setDraft({ best_offer_auto_accept: e.target.value })}
              />
              <p className="mt-1 text-xs text-(--color-text-faint)">
                Leave blank to review every offer yourself.
              </p>
            </Field>
            <Field label="Auto-decline offers below">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={draft.best_offer_auto_decline}
                onChange={(e) => setDraft({ best_offer_auto_decline: e.target.value })}
              />
            </Field>
          </Row>
        )}
      </div>

      {access.status === "reconnect" ? (
        <MarketingReconnectNotice />
      ) : (
        <div className="space-y-3">
          <Checkbox
            label="Add a multi-buy discount — buyers save when they buy more than one"
            checked={draft.multibuy_enabled}
            onChange={(e) => setDraft({ multibuy_enabled: e.target.checked })}
          />
          {draft.multibuy_enabled && (
            <>
              <p className="flex items-start gap-2 rounded-(--radius-btn) bg-(--color-info-bg) px-3 py-2 text-xs text-(--color-info-text)">
                <Lightbulb size={14} className="mt-0.5 shrink-0" />
                Setting Buy 2 to 10% or more makes buyers more likely to buy more than one.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <TierSelect
                  label="Buy 2 and save"
                  required
                  value={draft.multibuy_2_pct}
                  onChange={(v) => setDraft({ multibuy_2_pct: v })}
                />
                <TierSelect
                  label="Buy 3 and save"
                  value={draft.multibuy_3_pct}
                  onChange={(v) => setDraft({ multibuy_3_pct: v })}
                />
                <TierSelect
                  label="Buy 4 or more and save"
                  value={draft.multibuy_4_pct}
                  onChange={(v) => setDraft({ multibuy_4_pct: v })}
                />
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
