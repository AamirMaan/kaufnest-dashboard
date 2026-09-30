/**
 * Integration tests for the Overview RPC functions (get_sales_overview,
 * get_expenses_overview, get_purchases_overview, get_payouts_overview).
 * These hit the REAL tenant_boughtopia schema over the network — not part
 * of the default `npx jest` run (see jest.integration.config.ts). Run with
 * `npm run test:integration`. Requires SUPABASE_SERVICE_ROLE_KEY and
 * NEXT_PUBLIC_SUPABASE_URL in the environment (already present in
 * .env.local for local runs).
 */
// Totals RPCs are guarded wrappers since 055; tests call <name>__impl (service role, no auth.uid()).
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

  // 053 retired Formula B for revenueByPlatform/platformBalance (they now
  // include buyer-paid shipping, like `revenue`); topProducts stays items-only.
  // Requires 053 applied to tenant_boughtopia.
  it("counts shipping_charged in revenue and per-platform sales but not topProducts, and sums platform_fee per platform", async () => {
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
        platform_fee: 2.25,
        currency: "EUR",
        date: "2020-01-15", // fixed past date, outside any real data's range
        status: "delivered",
        created_by: testCreatedBy,
      })
      .select("id")
      .single();
    if (error) throw error;
    insertedSaleIds.push(data.id);

    const { data: result, error: rpcError } = await client.rpc("get_sales_overview__impl", {
      p_from: "2020-01-01",
      p_to: "2020-01-31",
      p_currency: "EUR",
    });
    if (rpcError) throw rpcError;

    // total_amount + shipping_charged = 110, everywhere except topProducts
    expect(result.revenue).toBe(110);
    expect(result.revenueByPlatform.find((p: { platform: string }) => p.platform === "ebay").value).toBe(110);
    const ebay = result.platformBalance.find((p: { platform: string }) => p.platform === "ebay");
    expect(ebay.sales).toBe(110);
    expect(ebay.platformFees).toBe(2.25);
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

    const { data: result, error: rpcError } = await client.rpc("get_sales_overview__impl", {
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

    const { data: result, error: rpcError } = await client.rpc("get_expenses_overview__impl", {
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

    const { data: purchases, error: pErr } = await client.rpc("get_purchases_overview__impl", params);
    if (pErr) throw pErr;
    expect(purchases).toEqual({ total: 0, vatPaid: 0, monthlyPurchases: [] });

    const { data: payouts, error: payErr } = await client.rpc("get_payouts_overview__impl", params);
    if (payErr) throw payErr;
    expect(payouts).toEqual({ transferred: [] });
  });

  // Requires migration 052 applied (sales.marketplace, get_sales_summary's
  // trailing p_marketplace/vat_base, get_sales_by_marketplace) — NOT yet
  // applied to any tenant schema as of 2026-09-28 (see supabase/SKILL.md's
  // file map). Written per the final-review fix wave (Task 9 Step 1 of
  // docs/superpowers/plans/2026-09-28-sales-marketplace-vat-base.md); do not
  // run until 052 lands on tenant_boughtopia — `npm run test:integration --
  // overviewRpc` will fail against the old 6-arg get_sales_summary until then.
  it("computes vat_base, p_marketplace filtering, and get_sales_by_marketplace revenue (052)", async () => {
    const client = createServiceClientForTenant(SCHEMA);
    const FROM = "2020-04-01";
    const TO = "2020-04-30";

    const { data: saleA, error: errA } = await client
      .from("sales")
      .insert({
        platform: "amazon",
        product_name: `${TEST_MARKER}-marketplace-a`,
        quantity: 1,
        unit_price: 100,
        total_amount: 100,
        shipping_charged: 10,
        vat_amount: 17.56,
        currency: "EUR",
        date: "2020-04-15",
        status: "delivered",
        marketplace: "amazon.de",
        created_by: testCreatedBy,
      })
      .select("id")
      .single();
    if (errA) throw errA;
    insertedSaleIds.push(saleA.id);

    const { data: saleB, error: errB } = await client
      .from("sales")
      .insert({
        platform: "amazon",
        product_name: `${TEST_MARKER}-marketplace-b`,
        quantity: 1,
        unit_price: 50,
        total_amount: 50,
        vat_amount: 0,
        currency: "EUR",
        date: "2020-04-16",
        status: "delivered",
        marketplace: null,
        created_by: testCreatedBy,
      })
      .select("id")
      .single();
    if (errB) throw errB;
    insertedSaleIds.push(saleB.id);

    const { data: summary, error: summaryErr } = await client.rpc("get_sales_summary", {
      p_from: FROM,
      p_to: TO,
      p_platform: null,
      p_currency: "EUR",
      p_status: null,
      p_pattern: null,
      p_marketplace: null,
    });
    if (summaryErr) throw summaryErr;
    // 100 + 10 − 17.56 = 92.44; B is excluded (vat_amount 0, not VAT-bearing).
    expect(Number(summary[0].vat_base)).toBeCloseTo(92.44, 2);

    const { data: unknown, error: unknownErr } = await client.rpc("get_sales_summary", {
      p_from: FROM,
      p_to: TO,
      p_platform: null,
      p_currency: "EUR",
      p_status: null,
      p_pattern: null,
      p_marketplace: "__unknown__",
    });
    if (unknownErr) throw unknownErr;
    expect(unknown[0].order_count).toBe(1);

    const { data: byMarket, error: byMarketErr } = await client.rpc("get_sales_by_marketplace__impl", {
      p_from: FROM,
      p_to: TO,
      p_currency: "EUR",
    });
    if (byMarketErr) throw byMarketErr;
    expect(
      byMarket.find((r: { marketplace: string | null }) => r.marketplace === "amazon.de")?.revenue
    ).toBeCloseTo(110, 2);
  });
});
