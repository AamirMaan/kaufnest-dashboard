"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Row, Select, Textarea } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import type { Plan, PlanFeature, PlanVisibility } from "@/lib/plans/entitlements";
import { detectReductions, validatePlan, type PlanErrors, type PlanInput } from "@/lib/plans/validatePlan";
import { ConfirmActionModal } from "../../_components/ConfirmActionModal";
import {
  emptyPlanInput,
  inputFromPlan,
  numberFieldValue,
  parseNumberField,
  parseOptionalNumberField,
  slugifyKey,
} from "../_lib/planFormState";

interface PlanFormProps {
  mode: "create" | "edit";
  original: Plan | null; // null in create mode
  catalog: Plan[];
  tenantCount: number; // tenants on `original` (0 in create mode)
  onSaved: (plan: Plan) => void;
}

type FieldKey = keyof PlanInput | "form";

const VISIBILITY_HELP: Record<PlanVisibility, string> = {
  public: "Shown on the pricing page and in the plan picker.",
  hidden: "Only you can assign it, from a tenant's page.",
  retired: "No new tenants. Tenants already on it keep it.",
};

const FEATURES: { field: PlanFeature; label: string }[] = [
  { field: "platformIntegrations", label: "Platform integrations (eBay & Amazon)" },
  { field: "aiFeatures", label: "AI features" },
  { field: "messagingAndListings", label: "Listings & messages" },
  { field: "advancedInventory", label: "Advanced inventory" },
];

const cardCls = "bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-6 space-y-4";
const headingCls = "text-base font-semibold text-(--color-text-strong)";
const helpCls = "text-xs text-(--color-text-faint) mt-1";
const noteCls = "text-xs text-(--color-warning-text) bg-(--color-warning-bg) rounded-[var(--radius-btn)] px-3 py-2";

export function PlanForm({ mode, original, catalog, tenantCount, onSaved }: PlanFormProps) {
  const router = useRouter();
  const toast = useToast();
  const isCreate = mode === "create";

  const [input, setInput] = useState<PlanInput>(original ? inputFromPlan(original) : emptyPlanInput());
  const [keyTouched, setKeyTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<PlanErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Set<FieldKey>>(new Set());

  const errors = validatePlan(input, { isCreate, catalog });
  const isFormValid = Object.keys(errors).length === 0;
  const isTrial = input.kind === "trial";
  const reductions = original ? detectReductions(original, input) : [];

  function update<K extends keyof PlanInput>(field: K, value: PlanInput[K]) {
    setInput((prev) => ({ ...prev, [field]: value }));
    clearServerError(field);
  }

  function clearServerError(field: FieldKey) {
    setServerErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function touch(field: FieldKey) {
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  }

  function errorFor(field: FieldKey): string | undefined {
    if (serverErrors[field]) return serverErrors[field];
    return attempted || touched.has(field) ? errors[field] : undefined;
  }

  function handleNameChange(name: string) {
    setInput((prev) => ({
      ...prev,
      name,
      key: isCreate && !keyTouched ? slugifyKey(name) : prev.key,
    }));
    clearServerError("name");
    if (isCreate && !keyTouched) clearServerError("key");
  }

  function handleAiToggle(on: boolean) {
    setInput((prev) => ({
      ...prev,
      aiFeatures: on,
      aiGenerationsPerMonth: on ? prev.aiGenerationsPerMonth : 0,
    }));
    clearServerError("aiFeatures");
    clearServerError("aiGenerationsPerMonth");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);
    if (!isFormValid) return;
    if (!isCreate && reductions.length > 0 && tenantCount > 0) {
      setConfirmOpen(true);
      return;
    }
    void save();
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(isCreate ? "/api/admin/plans" : `/api/admin/plans/${original!.key}`, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => ({}))) as { plan?: Plan; error?: string; fieldErrors?: PlanErrors };
      if (res.ok && data.plan) {
        toast.success(isCreate ? "Plan created" : "Plan saved");
        onSaved(data.plan);
      } else {
        setServerErrors(data.fieldErrors ?? {});
        toast.error(data.error ?? "Could not save the plan.");
      }
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  const priceChanged =
    !isCreate && original !== null && !isTrial && input.monthlyEur !== original.monthlyEur;
  const newlyRetired = input.visibility === "retired" && original?.visibility !== "retired";
  const unlimited = input.maxUsers === null;

  return (
    <>
      <form id="plan-form" onSubmit={handleSubmit} className="space-y-6">
        {serverErrors.form && (
          <p className="text-sm text-(--color-danger) bg-(--color-danger-bg) rounded-[var(--radius-btn)] px-3 py-2">
            {serverErrors.form}
          </p>
        )}

        {/* 1. Identity */}
        <section className={cardCls}>
          <h2 className={headingCls}>Identity</h2>
          <Row>
            <Field label="Name" required error={errorFor("name")}>
              <Input
                value={input.name}
                onChange={(e) => handleNameChange(e.target.value)}
                onBlur={() => touch("name")}
                placeholder="Enterprise"
                required
              />
            </Field>
            <Field label="Key" required error={errorFor("key")}>
              <Input
                value={input.key}
                onChange={(e) => {
                  setKeyTouched(true);
                  update("key", e.target.value);
                }}
                onBlur={() => touch("key")}
                readOnly={!isCreate}
                className="font-mono"
                placeholder="enterprise"
                required
              />
              <p className={helpCls}>
                {isCreate ? "Lowercase letters, digits and _" : "Used by billing — can't change"}
              </p>
            </Field>
          </Row>
          <Field label="Tagline" error={errorFor("tagline")}>
            <Textarea
              rows={2}
              value={input.tagline}
              onChange={(e) => update("tagline", e.target.value)}
              onBlur={() => touch("tagline")}
              placeholder="One line shown under the plan name on the pricing page."
            />
          </Field>
        </section>

        {/* 2. Visibility (not for the trial) */}
        {!isTrial && (
          <section className={cardCls}>
            <h2 className={headingCls}>Visibility</h2>
            <Field label="Visibility" required error={errorFor("visibility")}>
              <Select
                value={input.visibility}
                onChange={(e) => update("visibility", e.target.value as PlanVisibility)}
                onBlur={() => touch("visibility")}
                required
              >
                <option value="public">Public</option>
                <option value="hidden">Hidden</option>
                <option value="retired">Retired</option>
              </Select>
              <p className={helpCls}>{VISIBILITY_HELP[input.visibility]}</p>
            </Field>
            {newlyRetired && <p className={noteCls}>{`${tenantCount} tenant(s) stay on this plan.`}</p>}
          </section>
        )}

        {/* 3. Price (paid only) */}
        {!isTrial && (
          <section className={cardCls}>
            <h2 className={headingCls}>Price</h2>
            <Field label="Monthly price (EUR)" required error={errorFor("monthlyEur")}>
              <Input
                type="number"
                step="0.01"
                min="1"
                value={numberFieldValue(input.monthlyEur)}
                onChange={(e) => update("monthlyEur", parseOptionalNumberField(e.target.value))}
                onBlur={() => touch("monthlyEur")}
                placeholder="40"
                required
              />
            </Field>
            {priceChanged && original && (
              <p className={noteCls}>
                {`Creates a new Stripe price. ${tenantCount} current subscriber(s) keep €${original.monthlyEur} until they change plan.`}
              </p>
            )}
          </section>
        )}

        {/* 4. Limits & features */}
        <section className={cardCls}>
          <h2 className={headingCls}>Limits &amp; features</h2>
          <Field label="Max users" error={errorFor("maxUsers")}>
            <div className="flex items-center gap-4">
              <Input
                type="number"
                min="1"
                step="1"
                value={numberFieldValue(input.maxUsers)}
                onChange={(e) => update("maxUsers", parseNumberField(e.target.value))}
                onBlur={() => touch("maxUsers")}
                disabled={unlimited}
                required={!unlimited}
                className="max-w-[10rem]"
              />
              <Checkbox
                label="Unlimited"
                checked={unlimited}
                onChange={(e) => update("maxUsers", e.target.checked ? null : (original?.maxUsers ?? 1))}
              />
            </div>
          </Field>
          <div className="space-y-2">
            {FEATURES.map(({ field, label }) => (
              <Checkbox
                key={field}
                label={label}
                checked={input[field]}
                onChange={(e) =>
                  field === "aiFeatures" ? handleAiToggle(e.target.checked) : update(field, e.target.checked)
                }
              />
            ))}
          </div>
          {input.aiFeatures && (
            <Field label="AI generations per month" required error={errorFor("aiGenerationsPerMonth")}>
              <Input
                type="number"
                min="0"
                step="1"
                value={numberFieldValue(input.aiGenerationsPerMonth)}
                onChange={(e) => update("aiGenerationsPerMonth", parseNumberField(e.target.value))}
                onBlur={() => touch("aiGenerationsPerMonth")}
                className="max-w-[10rem]"
                required
              />
            </Field>
          )}
        </section>

        {/* 5. Trial (trial only) */}
        {isTrial && (
          <section className={cardCls}>
            <h2 className={headingCls}>Trial</h2>
            <Field label="Trial length (days)" required error={errorFor("trialDays")}>
              <Input
                type="number"
                min="1"
                max="90"
                step="1"
                value={numberFieldValue(input.trialDays)}
                onChange={(e) => update("trialDays", parseOptionalNumberField(e.target.value))}
                onBlur={() => touch("trialDays")}
                className="max-w-[10rem]"
                required
              />
              <p className={helpCls}>Applies to new sign-ups only.</p>
            </Field>
          </section>
        )}

        {/* 6. Display */}
        <section className={cardCls}>
          <h2 className={headingCls}>Display</h2>
          <Field label="Display order" required error={errorFor("sortOrder")}>
            <Input
              type="number"
              step="1"
              value={numberFieldValue(input.sortOrder)}
              onChange={(e) => update("sortOrder", parseNumberField(e.target.value))}
              onBlur={() => touch("sortOrder")}
              className="max-w-[10rem]"
              required
            />
          </Field>
          <Checkbox
            label="Highlight on pricing page"
            checked={input.highlighted}
            onChange={(e) => update("highlighted", e.target.checked)}
          />
        </section>
      </form>

      <div className="flex items-center justify-end gap-2 mt-6">
        <Button variant="secondary" type="button" onClick={() => router.push("/admin/plans")} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" form="plan-form" disabled={saving || !isFormValid}>
          {saving ? "Saving…" : isCreate ? "Create plan" : "Save changes"}
        </Button>
      </div>

      {original && (
        <ConfirmActionModal
          open={confirmOpen}
          title="Reduce this plan?"
          message={`${tenantCount} tenant(s) on ${original.name} lose: ${reductions.join("; ")}. This applies immediately.`}
          confirmLabel="Save changes"
          confirmingLabel="Saving…"
          tone="warning"
          loading={saving}
          onConfirm={() => void save()}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}
