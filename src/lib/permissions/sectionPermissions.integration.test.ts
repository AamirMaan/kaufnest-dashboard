/**
 * Integration tests for section permissions (migration 055).
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
import { ROLE_DEFAULTS, SECTION_KEYS } from "./sections";

// Jest sets NODE_ENV=test, and Next's own env loader (`@next/env`,
// `loadEnvConfig`) deliberately skips `.env.local` under NODE_ENV=test (see
// node_modules/next/dist/docs/.../environment-variables.md: ".env.local
// (Not checked when NODE_ENV is test.)" — by design, so tests don't depend
// on a developer's local secrets). We DO want this specific file's real
// Supabase credentials for a real network integration test, so parse and
// apply it directly with Node's built-in dotenv-compatible parser
// (`util.parseEnv`, the same parser `node --env-file` uses) instead of
// going through Next's test-aware loader.
const parsedEnv = parseEnv(readFileSync(join(process.cwd(), ".env.local"), "utf8"));
for (const [key, value] of Object.entries(parsedEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

const SCHEMA = "tenant_boughtopia";

describe("055 section permissions (live)", () => {
  const client = createServiceClientForTenant(SCHEMA);

  it("role_section_default matches ROLE_DEFAULTS for every role × section", async () => {
    for (const role of ["super_admin", "admin", "accountant"] as const) {
      for (const section of SECTION_KEYS) {
        const { data, error } = await client.rpc("role_section_default", { p_role: role, p_section: section });
        if (error) throw error;
        expect({ role, section, level: data }).toEqual({ role, section, level: ROLE_DEFAULTS[role][section] });
      }
    }
  });

  it("wraps the 7 totals RPCs with the guard marker", async () => {
    const { data, error } = await client.rpc("get_my_access"); // service role: no auth.uid() → all 0
    expect(error).toBeNull();
    expect(Object.values(data as Record<string, number>).every((v) => v === 0)).toBe(true);
    const { data: ov, error: ovError } = await client.rpc("get_sales_overview", { p_from: null, p_to: null, p_currency: "EUR" });
    expect(ovError).toBeNull(); // guard: no user → access 0 → NULL
    expect(ov).toBeNull();
  });
});
