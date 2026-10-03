import type { Plan, PlanKind, PlanVisibility } from "./entitlements";

/** Pure: shared by the /admin plan form (client) and the admin plan API routes. */

export type PlanInput = Omit<Plan, "stripeProductId" | "stripePriceId">;
export type PlanErrors = Partial<Record<keyof PlanInput | "form", string>>;

const KEY_RE = /^[a-z][a-z0-9_]{1,31}$/;
const MAX_EUR = 100_000;

const FEATURE_LABELS = {
  platformIntegrations: "Platform integrations",
  aiFeatures: "AI features",
  messagingAndListings: "Listings & messages",
  advancedInventory: "Advanced inventory",
} as const;

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

export function parsePlanInput(body: unknown): PlanInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  return {
    key: String(b.key ?? "").trim(),
    kind: (b.kind === "trial" ? "trial" : "paid") as PlanKind,
    name: String(b.name ?? "").trim(),
    tagline: String(b.tagline ?? "").trim(),
    visibility: (["public", "hidden", "retired"].includes(b.visibility as string) ? b.visibility : "public") as PlanVisibility,
    monthlyEur: toNum(b.monthlyEur),
    maxUsers: toNum(b.maxUsers),
    platformIntegrations: b.platformIntegrations === true,
    aiFeatures: b.aiFeatures === true,
    aiGenerationsPerMonth: toNum(b.aiGenerationsPerMonth) ?? 0,
    messagingAndListings: b.messagingAndListings === true,
    advancedInventory: b.advancedInventory === true,
    trialDays: toNum(b.trialDays),
    sortOrder: toNum(b.sortOrder) ?? 0,
    highlighted: b.highlighted === true,
  };
}

const isInt = (n: number | null): n is number => n !== null && Number.isInteger(n);

export function validatePlan(input: PlanInput, ctx: { isCreate: boolean; catalog: readonly Plan[] }): PlanErrors {
  const e: PlanErrors = {};

  if (!KEY_RE.test(input.key)) {
    e.key = "Use 2–32 lowercase letters, digits or _, starting with a letter.";
  } else if (input.kind === "paid" && input.key === "trial") {
    e.key = "\"trial\" is reserved for the free trial.";
  } else if (ctx.isCreate && ctx.catalog.some((p) => p.key === input.key)) {
    e.key = "A plan with this key already exists.";
  }

  if (ctx.isCreate && input.kind !== "paid") e.kind = "Only paid plans can be created.";
  if (!input.name) e.name = "Name is required.";

  if (input.kind === "paid") {
    const eur = input.monthlyEur;
    if (eur === null || Number.isNaN(eur) || eur < 1 || eur > MAX_EUR) {
      e.monthlyEur = "Enter a monthly price between €1 and €100,000.";
    } else if (Math.abs(Math.round(eur * 100) - eur * 100) > 1e-6) {
      e.monthlyEur = "Use at most two decimals.";
    }
  } else {
    if (!isInt(input.trialDays) || input.trialDays < 1 || input.trialDays > 90) {
      e.trialDays = "Trial length must be 1–90 days.";
    }
    if (input.visibility !== "hidden") e.visibility = "The trial is always hidden.";
  }

  if (input.maxUsers !== null && (!isInt(input.maxUsers) || input.maxUsers < 1)) {
    e.maxUsers = "Max users must be a whole number of 1 or more, or Unlimited.";
  }

  if (!isInt(input.aiGenerationsPerMonth) || input.aiGenerationsPerMonth < 0) {
    e.aiGenerationsPerMonth = "AI generations must be a whole number of 0 or more.";
  } else if (!input.aiFeatures && input.aiGenerationsPerMonth !== 0) {
    e.aiGenerationsPerMonth = "Turn on AI features to give an AI allowance.";
  }

  if (!isInt(input.sortOrder)) e.sortOrder = "Display order must be a whole number.";

  if (input.kind === "paid" && !e.visibility) {
    const otherPublic = ctx.catalog.filter(
      (p) => p.kind === "paid" && p.visibility === "public" && p.key !== input.key
    ).length;
    if (otherPublic + (input.visibility === "public" ? 1 : 0) < 1) {
      e.visibility = "Keep at least one public plan.";
    }
  }

  return e;
}

const fmtUsers = (n: number | null) => (n === null ? "Unlimited" : String(n));

/** Edits that take something away from tenants already on the plan. */
export function detectReductions(before: Plan, after: PlanInput): string[] {
  const out: string[] = [];
  const b = before.maxUsers ?? Infinity;
  const a = after.maxUsers ?? Infinity;
  if (a < b) out.push(`Max users: ${fmtUsers(before.maxUsers)} → ${fmtUsers(after.maxUsers)}`);
  for (const f of Object.keys(FEATURE_LABELS) as (keyof typeof FEATURE_LABELS)[]) {
    if (before[f] && !after[f]) out.push(`Removes ${FEATURE_LABELS[f]}`);
  }
  if (after.aiFeatures && after.aiGenerationsPerMonth < before.aiGenerationsPerMonth) {
    out.push(`AI generations / month: ${before.aiGenerationsPerMonth} → ${after.aiGenerationsPerMonth}`);
  }
  return out;
}

const INPUT_KEYS: (keyof PlanInput)[] = [
  "key", "kind", "name", "tagline", "visibility", "monthlyEur", "maxUsers",
  "platformIntegrations", "aiFeatures", "aiGenerationsPerMonth", "messagingAndListings",
  "advancedInventory", "trialDays", "sortOrder", "highlighted",
];

export function planDiff(before: Plan | null, after: PlanInput): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of INPUT_KEYS) {
    const from = before ? before[k] : null;
    if (from !== after[k]) diff[k] = { from, to: after[k] };
  }
  return diff;
}

export function planInputToRow(i: PlanInput): Record<string, unknown> {
  return {
    key: i.key,
    kind: i.kind,
    name: i.name,
    tagline: i.tagline,
    visibility: i.visibility,
    monthly_eur: i.kind === "paid" ? i.monthlyEur : null,
    max_users: i.maxUsers,
    platform_integrations: i.platformIntegrations,
    ai_features: i.aiFeatures,
    ai_generations_per_month: i.aiFeatures ? i.aiGenerationsPerMonth : 0,
    messaging_and_listings: i.messagingAndListings,
    advanced_inventory: i.advancedInventory,
    trial_days: i.kind === "trial" ? i.trialDays : null,
    sort_order: i.sortOrder,
    highlighted: i.highlighted,
  };
}
