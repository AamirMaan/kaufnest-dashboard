/**
 * Plan catalog types + every plan-gating helper (pure, client-safe).
 * Replaces the hardcoded PLAN_LIMITS table that lived in
 * lib/utils/planGating.ts. Rows come from control.plans (control-plane 012)
 * via the server-only lib/plans/catalog.ts.
 */

export type PlanKey = string;
export type PlanKind = "trial" | "paid";
export type PlanVisibility = "public" | "hidden" | "retired";

export interface Plan {
  key: PlanKey;
  kind: PlanKind;
  name: string;
  tagline: string;
  visibility: PlanVisibility;
  monthlyEur: number | null;
  stripeProductId: string | null;
  stripePriceId: string | null;
  /** null = unlimited */
  maxUsers: number | null;
  platformIntegrations: boolean;
  aiFeatures: boolean;
  aiGenerationsPerMonth: number;
  messagingAndListings: boolean;
  advancedInventory: boolean;
  trialDays: number | null;
  sortOrder: number;
  highlighted: boolean;
}

/** A control.plans row as PostgREST returns it. */
export interface PlanRow {
  key: string;
  kind: string;
  name: string;
  tagline: string;
  visibility: string;
  monthly_eur: number | null;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  max_users: number | null;
  platform_integrations: boolean;
  ai_features: boolean;
  ai_generations_per_month: number;
  messaging_and_listings: boolean;
  advanced_inventory: boolean;
  trial_days: number | null;
  sort_order: number;
  highlighted: boolean;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function planFromRow(r: PlanRow): Plan {
  return {
    key: r.key,
    kind: r.kind === "trial" ? "trial" : "paid",
    name: r.name,
    tagline: r.tagline ?? "",
    visibility: r.visibility === "hidden" || r.visibility === "retired" ? r.visibility : "public",
    monthlyEur: num(r.monthly_eur),
    stripeProductId: r.stripe_product_id,
    stripePriceId: r.stripe_price_id,
    maxUsers: num(r.max_users),
    platformIntegrations: r.platform_integrations,
    aiFeatures: r.ai_features,
    aiGenerationsPerMonth: num(r.ai_generations_per_month) ?? 0,
    messagingAndListings: r.messaging_and_listings,
    advancedInventory: r.advanced_inventory,
    trialDays: num(r.trial_days),
    sortOrder: num(r.sort_order) ?? 0,
    highlighted: r.highlighted,
  };
}

export interface PlanEntitlements {
  /** Infinity = unlimited */
  maxUsers: number;
  platformIntegrations: boolean;
  aiFeatures: boolean;
  /** Monthly pool of AI generations shared by the whole tenant (src/lib/ai/quota.ts). */
  aiGenerationsPerMonth: number;
  /** Messages + Listings. */
  messagingAndListings: boolean;
  /** Batches, locations and FIFO cost of goods (advanced inventory). */
  advancedInventory: boolean;
}

/** Unknown/missing plan: nothing unlocked. A typo'd key must never grant features. */
export const NO_ENTITLEMENTS: PlanEntitlements = Object.freeze({
  maxUsers: 1,
  platformIntegrations: false,
  aiFeatures: false,
  aiGenerationsPerMonth: 0,
  messagingAndListings: false,
  advancedInventory: false,
});

export function entitlementsOf(plan: Plan | null | undefined): PlanEntitlements {
  if (!plan) return NO_ENTITLEMENTS;
  return {
    maxUsers: plan.maxUsers === null ? Infinity : plan.maxUsers,
    platformIntegrations: plan.platformIntegrations,
    aiFeatures: plan.aiFeatures,
    aiGenerationsPerMonth: plan.aiFeatures ? plan.aiGenerationsPerMonth : 0,
    messagingAndListings: plan.messagingAndListings,
    advancedInventory: plan.advancedInventory,
  };
}

export const canAddUser = (ent: PlanEntitlements, currentUserCount: number): boolean =>
  currentUserCount < ent.maxUsers;
export const hasPlatformIntegrations = (ent: PlanEntitlements): boolean => ent.platformIntegrations;
export const hasAiFeatures = (ent: PlanEntitlements): boolean => ent.aiFeatures;
export const getAiGenerationLimit = (ent: PlanEntitlements): number => ent.aiGenerationsPerMonth;
export const hasMessagingAndListings = (ent: PlanEntitlements): boolean => ent.messagingAndListings;
export const hasAdvancedInventory = (ent: PlanEntitlements): boolean => ent.advancedInventory;

export type PlanFeature = "platformIntegrations" | "aiFeatures" | "messagingAndListings" | "advancedInventory";
export const PLAN_FEATURES: readonly PlanFeature[] = [
  "platformIntegrations",
  "aiFeatures",
  "messagingAndListings",
  "advancedInventory",
] as const;

export function sortPlans(plans: readonly Plan[]): Plan[] {
  return [...plans].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

/** Names of the PUBLIC paid plans that include `feature`, in display order. */
export function plansWithFeature(plans: readonly Plan[], feature: PlanFeature): string[] {
  return sortPlans(plans)
    .filter((p) => p.kind === "paid" && p.visibility === "public" && p[feature])
    .map((p) => p.name);
}

export function planNamesByFeature(plans: readonly Plan[]): Record<PlanFeature, string[]> {
  return Object.fromEntries(PLAN_FEATURES.map((f) => [f, plansWithFeature(plans, f)])) as Record<PlanFeature, string[]>;
}

/** ["Pro","Business"] → "the Pro and Business plans"; [] → null. */
export function formatPlanList(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `the ${names[0]} plan`;
  return `the ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} plans`;
}

/** Upgrade-screen sentence: "<subject> is available on the Business plan." */
export function availabilityLine(subject: string, names: readonly string[]): string {
  const list = formatPlanList(names);
  return list ? `${subject} is available on ${list}.` : "Contact us to unlock this feature.";
}

/**
 * Can a tenant currently on `currentPlanKey` buy `plan` through Stripe
 * (checkout / change-plan)? Hidden plans are custom deals: only the tenant a
 * platform admin already put on that plan may pay for it.
 */
export function canPurchase(plan: Plan, currentPlanKey: PlanKey | null): boolean {
  if (plan.kind !== "paid" || !plan.stripePriceId) return false;
  if (plan.visibility === "public") return true;
  if (plan.visibility === "hidden") return plan.key === currentPlanKey;
  return false;
}

/** Can /admin put a tenant on `plan`? Retired plans only when unchanged. */
export function isAssignablePlan(plan: Plan | null, currentPlanKey: PlanKey | null): boolean {
  if (!plan) return false;
  return plan.visibility !== "retired" || plan.key === currentPlanKey;
}
