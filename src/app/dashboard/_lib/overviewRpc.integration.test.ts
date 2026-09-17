/**
 * Integration tests for the Overview RPC functions (get_sales_overview,
 * get_expenses_overview, get_purchases_overview, get_payouts_overview).
 * These hit the REAL tenant_boughtopia schema over the network — not part
 * of the default `npx jest` run (see jest.integration.config.ts). Run with
 * `npm run test:integration`. Requires SUPABASE_SERVICE_ROLE_KEY and
 * NEXT_PUBLIC_SUPABASE_URL in the environment (already present in
 * .env.local for local runs).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { parseEnv } from "util";
import { createServiceClientForTenant } from "@/lib/supabase/server";

// Jest sets NODE_ENV=test, and Next's own env loader (`@next/env`,
// `loadEnvConfig`) deliberately skips `.env.local` under NODE_ENV=test (see
// node_modules/next/dist/docs/.../environment-variables.md: ".env.local
// (Not checked when NODE_ENV is test.)" — by design, so tests don't depend
// on a developer's local secrets). We DO want this specific file's real
// Supabase credentials for a real network integration test, so parse and
// apply it directly with Node's built-in dotenv-compatible parser
// (`util.parseEnv`, the same parser `node --env-file` uses) instead of
// going through Next's test-aware loader. `process.loadEnvFile()` doesn't
// work here either — jest's NodeEnvironment replaces `process.env` with a
// static snapshot object before this file's top-level code runs, and
// `loadEnvFile` writes to Node's real env store, not that snapshot; a
// plain `process.env.KEY = value` assignment (what `parseEnv` + a manual
// loop does below) mutates the snapshot object directly, so it works.
const parsedEnv = parseEnv(readFileSync(join(process.cwd(), ".env.local"), "utf8"));
for (const [key, value] of Object.entries(parsedEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

const SCHEMA = "tenant_boughtopia";
const TEST_MARKER = "overview-rpc-integration-test";

describe("Overview RPC functions (tenant_boughtopia)", () => {
  const insertedSaleIds: string[] = [];
  const insertedExpenseIds: string[] = [];
  let testCreatedBy: string;

  beforeAll(async () => {
    const client = createServiceClientForTenant(SCHEMA);
    const { data, error } = await client.from("profiles").select("id").limit(1).single();
    if (error) throw error;
    testCreatedBy = data.id;
  });

  afterEach(async () => {
    const client = createServiceClientForTenant(SCHEMA);
    if (insertedSaleIds.length > 0) {
      await client.from("sales").delete().in("id", insertedSaleIds);
      insertedSaleIds.length = 0;
    }
    if (insertedExpenseIds.length > 0) {
      await client.from("expenses").delete().in("id", insertedExpenseIds);
      insertedExpenseIds.length = 0;
    }
  });

  it("distinguishes Formula A (revenue) from Formula B (revenueByPlatform/topProducts) when shipping_charged is set", async () => {
    const client = createServiceClientForTenant(SCHEMA);
    // Need a real created_by (profiles.id) and product_name — insert with
    // a distinctive product_name/date so this test's rows are unambiguous
    // even if run concurrently with other activity in the schema.
    const { data, error } = await client
      .from("sales")
      .insert({
        platform: "ebay",
        product_name: `${TEST_MARKER}-widget`,
        quantity: 1,
        unit_price: 100,
        total_amount: 100,
        shipping_charged: 10,
        currency: "EUR",
        date: "2020-01-15", // fixed past date, outside any real data's range
        status: "delivered",
        created_by: testCreatedBy,
      })
      .select("id")
      .single();
    if (error) throw error;
    insertedSaleIds.push(data.id);

    const { data: result, error: rpcError } = await client.rpc("get_sales_overview", {
      p_from: "2020-01-01",
      p_to: "2020-01-31",
      p_currency: "EUR",
    });
    if (rpcError) throw rpcError;

    // Formula A: total_amount + shipping_charged = 110
    expect(result.revenue).toBe(110);
    // Formula B: total_amount alone = 100 — proves the two formulas were
    // NOT accidentally unified.
    expect(result.revenueByPlatform.find((p: { platform: string }) => p.platform === "ebay").value).toBe(100);
    expect(result.topProducts.find((p: { name: string }) => p.name === `${TEST_MARKER}-widget`).revenue).toBe(100);
  });

  it("excludes a returned sale from revenue/unitsSold/effectiveOrderCount but still counts it in orderCount", async () => {
    const client = createServiceClientForTenant(SCHEMA);
    const { data, error } = await client
      .from("sales")
      .insert({
        platform: "amazon",
        product_name: `${TEST_MARKER}-returned-widget`,
        quantity: 2,
        unit_price: 50,
        total_amount: 100,
        currency: "EUR",
        date: "2020-02-15",
        status: "returned",
        created_by: testCreatedBy,
      })
      .select("id")
      .single();
    if (error) throw error;
    insertedSaleIds.push(data.id);

    const { data: result, error: rpcError } = await client.rpc("get_sales_overview", {
      p_from: "2020-02-01",
      p_to: "2020-02-28",
      p_currency: "EUR",
    });
    if (rpcError) throw rpcError;

    expect(result.orderCount).toBeGreaterThanOrEqual(1);
    // A returned-only period contributes 0 to every effective-sales figure.
    expect(result.revenue).toBe(0);
    expect(result.unitsSold).toBe(0);
    expect(result.effectiveOrderCount).toBe(0);
  });

  it("matches an expense to a platform via case-insensitive vendor/title substring, not a column", async () => {
    const client = createServiceClientForTenant(SCHEMA);
    const { data, error } = await client
      .from("expenses")
      .insert({
        title: `${TEST_MARKER} EBAY selling fees`, // mixed case on purpose
        amount: 25,
        currency: "EUR",
        category: "advertising",
        date: "2020-03-15",
        created_by: testCreatedBy,
      })
      .select("id")
      .single();
    if (error) throw error;
    insertedExpenseIds.push(data.id);

    const { data: result, error: rpcError } = await client.rpc("get_expenses_overview", {
      p_from: "2020-03-01",
      p_to: "2020-03-31",
      p_currency: "EUR",
    });
    if (rpcError) throw rpcError;

    expect(result.platformSubtotal.find((p: { platform: string }) => p.platform === "ebay").amount).toBe(25);
    expect(result.platformSubtotal.find((p: { platform: string }) => p.platform === "amazon").amount).toBe(0);
  });

  it("get_purchases_overview and get_payouts_overview return the documented shape on an empty period", async () => {
    const client = createServiceClientForTenant(SCHEMA);
    const params = { p_from: "1999-01-01", p_to: "1999-01-02", p_currency: "EUR" };

    const { data: purchases, error: pErr } = await client.rpc("get_purchases_overview", params);
    if (pErr) throw pErr;
    expect(purchases).toEqual({ total: 0, vatPaid: 0, monthlyPurchases: [] });

    const { data: payouts, error: payErr } = await client.rpc("get_payouts_overview", params);
    if (payErr) throw payErr;
    expect(payouts).toEqual({ transferred: [] });
  });
});
