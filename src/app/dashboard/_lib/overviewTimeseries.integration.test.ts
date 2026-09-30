/**
 * Integration test for get_overview_timeseries (051_overview_timeseries.sql).
 * Hits the REAL tenant_boughtopia schema — only runs via
 * `npm run test:integration`, and only after 051 has been applied. Same
 * env-loading approach as overviewRpc.integration.test.ts (see the long
 * comment there).
 */
// Totals RPCs are guarded wrappers since 055; tests call <name>__impl (service role, no auth.uid()).
import { readFileSync } from "fs";
import { join } from "path";
import { parseEnv } from "util";
import { createServiceClientForTenant } from "@/lib/supabase/server";
import type { OverviewTimeseries } from "./overviewTypes";

const parsedEnv = parseEnv(readFileSync(join(process.cwd(), ".env.local"), "utf8"));
for (const [key, value] of Object.entries(parsedEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const SCHEMA = "tenant_boughtopia";
const MARKER = "timeseries-rpc-integration-test";

describe("get_overview_timeseries (tenant_boughtopia)", () => {
  const saleIds: string[] = [];
  const expenseIds: string[] = [];
  const purchaseIds: string[] = [];
  let createdBy: string;

  beforeAll(async () => {
    const client = createServiceClientForTenant(SCHEMA);
    const { data, error } = await client.from("profiles").select("id").limit(1).single();
    if (error) throw error;
    createdBy = data.id;
  });

  afterAll(async () => {
    const client = createServiceClientForTenant(SCHEMA);
    if (purchaseIds.length > 0) await client.from("purchases").delete().in("id", purchaseIds);
    if (expenseIds.length > 0) await client.from("expenses").delete().in("id", expenseIds);
    if (saleIds.length > 0) await client.from("sales").delete().in("id", saleIds);
  });

  it("returns zero-filled months, previous totals and the top vendor", async () => {
    const client = createServiceClientForTenant(SCHEMA);
    const sale = {
      platform: "other", product_name: MARKER, quantity: 1, unit_price: 10,
      currency: "EUR", date: "2001-01-15", created_by: createdBy, description: MARKER,
    };
    const sales = await client.from("sales").insert([
      { ...sale, total_amount: 100, shipping_charged: 10, platform_fee: 5, vat_amount: 19, status: "shipped" },
      { ...sale, total_amount: 50, status: "returned" },
    ]).select("id");
    if (sales.error) throw sales.error;
    saleIds.push(...sales.data.map((r: { id: string }) => r.id));

    const expenses = await client.from("expenses").insert([
      { title: MARKER, amount: 30, vat_amount: 5, category: "software", currency: "EUR",
        date: "2001-02-10", created_by: createdBy },
    ]).select("id");
    if (expenses.error) throw expenses.error;
    expenseIds.push(...expenses.data.map((r: { id: string }) => r.id));

    const purchases = await client.from("purchases").insert([
      { product_name: MARKER, quantity: 2, unit_price: 20, total_amount: 40, currency: "EUR",
        vendor: MARKER, date: "2001-02-12", created_by: createdBy },
    ]).select("id");
    if (purchases.error) throw purchases.error;
    purchaseIds.push(...purchases.data.map((r: { id: string }) => r.id));

    const { data, error } = await client.rpc("get_overview_timeseries__impl", {
      p_from: "2001-01-01", p_to: "2001-03-31", p_currency: "EUR",
    });
    if (error) throw error;
    const ts = data as OverviewTimeseries;

    expect(ts.months.map((m) => m.month)).toEqual(["2001-01", "2001-02", "2001-03"]);
    const [jan, feb, mar] = ts.months;
    expect(jan).toEqual(expect.objectContaining({
      revenue_by_platform: { other: 110 }, orders: 2, returned_cancelled: 1, fees: 5, vat_collected: 19,
    }));
    expect(feb).toEqual(expect.objectContaining({
      expenses: 30, expenses_by_category: { software: 30 }, purchases: 40, units: 2, vat_paid: 5,
    }));
    expect(mar).toEqual(expect.objectContaining({ orders: 0, expenses: 0, purchases: 0, revenue_by_platform: {} }));
    expect(ts.previous).toEqual(expect.objectContaining({
      revenue: expect.any(Number), expenses: expect.any(Number), purchases: expect.any(Number),
      orders: expect.any(Number), fees: expect.any(Number),
    }));
    expect(ts.top_vendor).toEqual({ name: MARKER, amount: 40 });

    const { data: allTime } = await client.rpc("get_overview_timeseries__impl", {
      p_from: null, p_to: null, p_currency: "EUR",
    });
    expect((allTime as OverviewTimeseries).previous).toBeNull();
  });

  // Requires 054 applied to the test tenant.
  it("compares a whole-month range with the previous calendar month and counts effective orders (054)", async () => {
    const client = createServiceClientForTenant(SCHEMA);
    const sale = {
      platform: "other", product_name: MARKER, quantity: 1, unit_price: 10,
      currency: "EUR", created_by: createdBy, description: MARKER,
    };
    // 2 and 3 Jan 2002 fall in "previous" for Feb 2002 only under the calendar
    // rule (Jan 1–31); the old 28-day window was Jan 4–31 and missed them.
    const res = await client.from("sales").insert([
      { ...sale, total_amount: 100, status: "shipped", date: "2002-01-02" },
      { ...sale, total_amount: 50, status: "returned", date: "2002-01-03" },
    ]).select("id");
    if (res.error) throw res.error;
    saleIds.push(...res.data.map((r: { id: string }) => r.id));

    const { data, error } = await client.rpc("get_overview_timeseries__impl", {
      p_from: "2002-02-01", p_to: "2002-02-28", p_currency: "EUR",
    });
    if (error) throw error;
    expect((data as OverviewTimeseries).previous).toEqual(expect.objectContaining({
      revenue: 100, orders: 2, effective_orders: 1,
    }));
  });

  // Requires 054 applied to the test tenant.
  it("get_platform_running_balance sums everything up to p_to, including earlier payouts (054)", async () => {
    const client = createServiceClientForTenant(SCHEMA);
    const res = await client.from("sales").insert({
      platform: "ebay", product_name: MARKER, quantity: 1, unit_price: 100, total_amount: 100,
      shipping_charged: 10, advertising_fee: 5, shipping_cost: 3, platform_fee: 2,
      currency: "EUR", date: "2003-01-10", status: "shipped", created_by: createdBy, description: MARKER,
    }).select("id").single();
    if (res.error) throw res.error;
    saleIds.push(res.data.id);

    const payouts = await client.from("platform_payouts").insert([
      { platform: "ebay", amount: 40, currency: "EUR", date: "2003-01-20", notes: MARKER, created_by: createdBy },
      { platform: "ebay", amount: 30, currency: "EUR", date: "2003-02-05", notes: MARKER, created_by: createdBy },
    ]).select("id");
    if (payouts.error) throw payouts.error;
    const payoutIds = payouts.data.map((r: { id: string }) => r.id);

    try {
      const { data, error } = await client.rpc("get_platform_running_balance__impl", {
        p_to: "2003-01-31", p_currency: "EUR",
      });
      if (error) throw error;
      const ebay = (data as { platform: string; earned: number; expenses: number; transferred: number }[])
        .find((r) => r.platform === "ebay");
      // 100 + 10 shipping charged − 5 ad − 3 shipping cost − 2 platform fee
      expect(Number(ebay?.earned)).toBeCloseTo(100, 2);
      // the 5 Feb payout is after p_to
      expect(Number(ebay?.transferred)).toBeCloseTo(40, 2);
    } finally {
      await client.from("platform_payouts").delete().in("id", payoutIds);
    }
  });
});
