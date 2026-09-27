/**
 * Integration tests for get_sales_summary / get_purchases_summary /
 * get_expenses_summary (049_table_summary_functions.sql). Hits the REAL
 * tenant_boughtopia schema — only runs via `npm run test:integration`, and
 * only after 049 has been applied. Same env-loading approach as
 * overviewRpc.integration.test.ts (see the long comment there).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { parseEnv } from "util";
import { createServiceClientForTenant } from "@/lib/supabase/server";

const parsedEnv = parseEnv(readFileSync(join(process.cwd(), ".env.local"), "utf8"));
for (const [key, value] of Object.entries(parsedEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const SCHEMA = "tenant_boughtopia";
const MARKER = "summary-rpc-integration-test";

describe("table summary RPCs (tenant_boughtopia)", () => {
  const saleIds: string[] = [];
  let createdBy: string;

  beforeAll(async () => {
    const client = createServiceClientForTenant(SCHEMA);
    const { data, error } = await client.from("profiles").select("id").limit(1).single();
    if (error) throw error;
    createdBy = data.id;
  });

  afterAll(async () => {
    if (saleIds.length > 0) {
      await createServiceClientForTenant(SCHEMA).from("sales").delete().in("id", saleIds);
    }
  });

  it("totals only matching rows and separates excluded orders", async () => {
    const client = createServiceClientForTenant(SCHEMA);
    const base = {
      platform: "other", product_name: MARKER, quantity: 1, unit_price: 10,
      currency: "EUR", date: "2001-01-15", created_by: createdBy, description: MARKER,
    };
    const { data, error } = await client.from("sales").insert([
      { ...base, total_amount: 100, vat_amount: 19, platform_fee: 5, status: "shipped" },
      { ...base, total_amount: 50, vat_amount: 0, status: "returned" },
    ]).select("id");
    if (error) throw error;
    saleIds.push(...data.map((r: { id: string }) => r.id));

    const { data: rows, error: rpcError } = await client.rpc("get_sales_summary", {
      p_from: "2001-01-01", p_to: "2001-01-31", p_platform: null,
      p_currency: "EUR", p_status: null, p_pattern: `%${MARKER}%`,
    });
    if (rpcError) throw rpcError;
    expect(rows).toEqual([
      expect.objectContaining({ currency: "EUR", order_count: 2, gross: 100, vat: 19, fees: 5, excluded_count: 1 }),
    ]);

    const { data: returnedOnly } = await client.rpc("get_sales_summary", {
      p_from: "2001-01-01", p_to: "2001-01-31", p_platform: null,
      p_currency: "EUR", p_status: "returned", p_pattern: `%${MARKER}%`,
    });
    expect(returnedOnly).toEqual([
      expect.objectContaining({ order_count: 1, gross: 50, excluded_count: 0 }),
    ]);
  });
});
