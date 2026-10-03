import type { Plan } from "@/lib/plans/entitlements";
import type { PlanInput } from "@/lib/plans/validatePlan";

/** Pure state helpers for the /admin plan form (PlanForm.tsx). */

/** A new paid, public plan with nothing unlocked — the "New plan" starting point. */
export function emptyPlanInput(): PlanInput {
  return {
    key: "",
    kind: "paid",
    name: "",
    tagline: "",
    visibility: "public",
    monthlyEur: null,
    maxUsers: null,
    platformIntegrations: false,
    aiFeatures: false,
    aiGenerationsPerMonth: 0,
    messagingAndListings: false,
    advancedInventory: false,
    trialDays: null,
    sortOrder: 0,
    highlighted: false,
  };
}

/** The editable fields of a catalog plan — Stripe ids are server-owned and dropped. */
export function inputFromPlan(plan: Plan): PlanInput {
  return {
    key: plan.key,
    kind: plan.kind,
    name: plan.name,
    tagline: plan.tagline,
    visibility: plan.visibility,
    monthlyEur: plan.monthlyEur,
    maxUsers: plan.maxUsers,
    platformIntegrations: plan.platformIntegrations,
    aiFeatures: plan.aiFeatures,
    aiGenerationsPerMonth: plan.aiGenerationsPerMonth,
    messagingAndListings: plan.messagingAndListings,
    advancedInventory: plan.advancedInventory,
    trialDays: plan.trialDays,
    sortOrder: plan.sortOrder,
    highlighted: plan.highlighted,
  };
}

/** Plan name → a key matching `^[a-z][a-z0-9_]{1,31}$` (best effort; validatePlan has the final say). */
export function slugifyKey(name: string): string {
  let key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (/^[0-9]/.test(key)) key = `p_${key}`;
  return key.slice(0, 32).replace(/_+$/, "");
}

/** The Visibility column's badge. The trial (stored as hidden) is labelled by its kind. */
export function visibilityBadge(plan: Pick<Plan, "kind" | "visibility">): {
  label: string;
  variant: "success" | "warning" | "info" | "default";
} {
  if (plan.kind === "trial") return { label: "Trial", variant: "warning" };
  if (plan.visibility === "public") return { label: "Public", variant: "success" };
  if (plan.visibility === "hidden") return { label: "Hidden", variant: "info" };
  return { label: "Retired", variant: "default" };
}

/**
 * A cleared number input for a field that must hold a number (max users when
 * not Unlimited, AI allowance, display order) becomes NaN, so validatePlan
 * reports it instead of the form silently sending 0 or "unlimited".
 */
export function parseNumberField(value: string): number {
  return value.trim() === "" ? NaN : Number(value);
}

/** A cleared price / trial-length input becomes null (validatePlan flags it when required). */
export function parseOptionalNumberField(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

/** The `value` prop for a number <input>: null/NaN render as empty. */
export function numberFieldValue(n: number | null): number | "" {
  return n === null || Number.isNaN(n) ? "" : n;
}
