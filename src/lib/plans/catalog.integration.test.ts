/**
 * Live parity test for control.plans (control-plane migration 012). Hits the
 * REAL control-plane project over the network — not part of the default
 * `npx jest` run (see jest.config.ts's testPathIgnorePatterns). Run with
 * `npm run test:integration -- src/lib/plans`. Requires
 * CONTROL_SUPABASE_URL and CONTROL_SUPABASE_SERVICE_KEY in the environment
 * (already present in .env.local for local runs).
 *
 * 012 has NOT been applied to the live control-plane database yet (see
 * task-2-brief.md / AGENTS.md). Until it is, `control.plans` doesn't exist
 * and PostgREST answers with PGRST205 (schema cache: table not found) or
 * the raw Postgres 42P01 (undefined_table) — either way this test SKIPS
 * with a console note instead of failing, so it goes green the moment the
 * migration lands with no code change needed here.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { parseEnv } from "util";
import { createClient } from "@supabase/supabase-js";
import { planFromRow, type Plan, type PlanRow } from "./entitlements";

// Jest sets NODE_ENV=test, and Next's own env loader skips .env.local under
// NODE_ENV=test by design (see sectionPermissions.integration.test.ts for
// the full citation). Parse it directly for this real network test.
const parsedEnv = parseEnv(readFileSync(join(process.cwd(), ".env.local"), "utf8"));
for (const [key, value] of Object.entries(parsedEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

// Global Constraints' seeded table — every column except the Stripe ids
// (those are populated by `npm run plans:seed-stripe`, not the migration).
const SEEDED: Record<string, Omit<Plan, "stripeProductId" | "stripePriceId">> = {
  trial: {
    key: "trial", kind: "trial", name: "Trial", tagline: "", visibility: "hidden",
    monthlyEur: null, maxUsers: null, platformIntegrations: true, aiFeatures: true,
    aiGenerationsPerMonth: 300, messagingAndListings: true, advancedInventory: true,
    trialDays: 14, sortOrder: 0, highlighted: false,
  },
  starter: {
    key: "starter", kind: "paid", name: "Starter",
    tagline: "Bookkeeping for a small team, entered by hand.", visibility: "public",
    monthlyEur: 20, maxUsers: 3, platformIntegrations: false, aiFeatures: false,
    aiGenerationsPerMonth: 0, messagingAndListings: false, advancedInventory: false,
    trialDays: null, sortOrder: 1, highlighted: false,
  },
  pro: {
    key: "pro", kind: "paid", name: "Pro",
    tagline: "Pull your eBay and Amazon orders in automatically.", visibility: "public",
    monthlyEur: 30, maxUsers: 5, platformIntegrations: true, aiFeatures: false,
    aiGenerationsPerMonth: 0, messagingAndListings: false, advancedInventory: false,
    trialDays: null, sortOrder: 2, highlighted: true,
  },
  business: {
    key: "business", kind: "paid", name: "Business",
    tagline: "Run listings, messages and the whole operation in one place.", visibility: "public",
    monthlyEur: 50, maxUsers: null, platformIntegrations: true, aiFeatures: true,
    aiGenerationsPerMonth: 300, messagingAndListings: true, advancedInventory: true,
    trialDays: null, sortOrder: 3, highlighted: false,
  },
};

/** PostgREST "table not found in schema cache" / Postgres "undefined_table". */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01";
}

describe("012 plan catalog (live)", () => {
  it("control.plans matches the seeded table for trial/starter/pro/business", async () => {
    const client = createClient(
      process.env.CONTROL_SUPABASE_URL!,
      process.env.CONTROL_SUPABASE_SERVICE_KEY!
    );

    const { data, error } = await client
      .schema("control")
      .from("plans")
      .select("*")
      .in("key", Object.keys(SEEDED));

    if (isMissingTable(error)) {
      console.log("[catalog.integration.test] control.plans does not exist yet (012 not applied) — skipping");
      return;
    }
    if (error) throw error;

    const rows = (data ?? []) as PlanRow[];
    expect(rows.map((r) => r.key).sort()).toEqual(Object.keys(SEEDED).sort());

    for (const row of rows) {
      const plan = planFromRow(row);
      const { stripeProductId, stripePriceId, ...comparable } = plan;
      void stripeProductId;
      void stripePriceId;
      expect(comparable).toEqual(SEEDED[row.key]);
    }
  });
});
