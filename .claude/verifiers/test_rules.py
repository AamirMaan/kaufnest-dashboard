"""Tests for the verifier rules and the PreToolUse guard.

Not part of the Jest suite: jest.config.ts only discovers `src/**/*.test.ts(x)`,
and these cover Python tooling. Run them directly:

    uv run .claude/verifiers/test_rules.py

Every rule needs both a positive and a negative case. A rule that only has a
positive case is the dangerous kind — it fires on the violation *and* on the
legitimate code next to it, and the first false positive teaches everyone to
ignore the verifier.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from rules import BLOCK, scan_text  # noqa: E402

HERE = Path(__file__).parent
REPO = HERE.parent.parent

CLIENT = '"use client";\n'

# (name, rel_path, source, expected_rule_id_or_None)
CASES: list[tuple[str, str, str, str | None]] = [
    # ---- secrets ----
    ("anthropic key literal", "src/lib/x.ts",
     'const k = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA";', "secret-literal"),
    ("stripe live key", "src/lib/x.ts",
     'const k = "sk_live_AAAAAAAAAAAAAAAAAAAA";', "secret-literal"),
    ("supabase service jwt", "src/lib/x.ts",
     'const k = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.sig";', "secret-literal"),
    ("service key from env is fine", "src/lib/x.ts",
     "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;", None),
    ("env example is exempt", ".env.local.example",
     'SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoieCJ9.s', None),

    # ---- tenant isolation ----
    ("public schema query", "src/app/dashboard/x.ts",
     'await sb.schema("public").from("sales").select();', "public-schema-query"),
    ("public.table string", "src/app/dashboard/x.ts",
     'await sb.from("public.sales").select();', "public-schema-query"),
    ("tenant client is fine", "src/app/dashboard/x.ts",
     "const sb = createTenantClient(schema);", None),
    ("hardcoded schema literal", "src/app/dashboard/x.ts",
     'const s = "tenant_kaufnest";', "hardcoded-tenant-schema"),
    ("schema from app_metadata is fine", "src/app/dashboard/x.ts",
     "const s = user.app_metadata.tenant_schema;", None),
    ("suppressed hardcoded schema", "src/app/dashboard/x.ts",
     'const s = "tenant_kaufnest"; // verifier:allow hardcoded-tenant-schema', None),
    ("suppression on the preceding line", "src/app/dashboard/x.ts",
     "// verifier:allow hardcoded-tenant-schema\n"
     'const s = "tenant_kaufnest";', None),
    ("suppression two lines up does NOT apply", "src/app/dashboard/x.ts",
     "// verifier:allow hardcoded-tenant-schema\n"
     "const unrelated = 1;\n"
     'const s = "tenant_kaufnest";', "hardcoded-tenant-schema"),
    ("suppression naming a different rule does not apply", "src/app/dashboard/x.ts",
     'const s = "tenant_kaufnest"; // verifier:allow no-any',
     "hardcoded-tenant-schema"),
    ("comma-separated suppression", "src/app/dashboard/x.ts",
     'const s: any = "tenant_kaufnest"; // verifier:allow no-any, hardcoded-tenant-schema',
     None),

    # ---- migrations ----
    ("new migration hardcodes schema", "supabase/migrations/030_new.sql",
     "ALTER TABLE tenant_kaufnest.sales ADD COLUMN foo text;",
     "migration-hardcodes-schema"),
    ("new migration uses helper", "supabase/migrations/030_new.sql",
     "SELECT public.run_on_all_tenant_schemas($$\n"
     "  ALTER TABLE {{schema}}.sales ADD COLUMN foo text;\n$$);", None),
    ("legacy migration exempt", "supabase/migrations/008_platform_integrations.sql",
     "alter table tenant_kaufnest.sales add column bar text;", None),
    ("dropship migration exempt", "supabase/migrations/031_dropship_thing.sql",
     "ALTER TABLE tenant_kaufnest.dropship_listings ADD COLUMN baz text;", None),

    # ---- server/client boundary ----
    ("control client in client component", "src/app/dashboard/p.tsx",
     CLIENT + 'import { createControlClient } from "@/lib/supabase/control";',
     "server-module-in-client"),
    ("integrations lib in client component", "src/app/dashboard/p.tsx",
     CLIENT + 'import { syncOrders } from "@/lib/integrations/ebay/sync";',
     "server-module-in-client"),
    ("stripe in client component", "src/app/dashboard/p.tsx",
     CLIENT + 'import Stripe from "stripe";', "server-module-in-client"),
    ("control client in server component is fine", "src/app/admin/page.tsx",
     'import { createControlClient } from "@/lib/supabase/control";', None),
    ("browser client in client component is fine", "src/app/dashboard/p.tsx",
     CLIENT + 'import { createTenantClient } from "@/lib/supabase/client";', None),
    ("server env in client component", "src/app/dashboard/p.tsx",
     CLIENT + "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;",
     "server-secret-in-client"),
    ("NEXT_PUBLIC env in client component is fine", "src/app/dashboard/p.tsx",
     CLIENT + "const u = process.env.NEXT_PUBLIC_SITE_URL;", None),
    ("server env in server component is fine", "src/app/api/x/route.ts",
     "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;", None),

    # ---- next.js structure ----
    ("middleware.ts is forbidden", "src/middleware.ts",
     "export function middleware() {}", "middleware-file"),
    ("proxy.ts is the right file", "src/proxy.ts",
     "export function proxy() {}", None),

    # ---- billing ----
    ("plan write outside webhook", "src/app/dashboard/admin/x.ts",
     'await c.from("tenants").update({ plan: "pro" }).eq("id", id);',
     "plan-write-outside-webhook"),
    # Webhook path is exempt. Uses a route.ts path, so the snippet also carries
    # a signature check — otherwise route-without-auth fires and the case would
    # be testing the wrong rule.
    ("plan write in webhook is fine", "src/app/api/billing/webhook/route.ts",
     "const event = stripe.webhooks.constructEvent(raw, sig, secret);\n"
     'await c.from("tenants").update({ plan: "pro" }).eq("id", id);', None),
    ("tenant status write is fine (admin lifecycle)",
     "src/app/dashboard/admin/x.ts",
     'await c.from("tenants").update({ status: "suspended" }).eq("id", id);', None),

    # ---- api hygiene ----
    ("db error to client", "src/app/api/x/route.ts",
     "return NextResponse.json({ error: error.message }, { status: 500 });",
     "db-error-to-client"),
    ("generic error is fine", "src/app/api/x/route.ts",
     'return NextResponse.json({ error: "Could not save" }, { status: 500 });', None),

    # ---- standards ----
    ("ts-ignore", "src/lib/x.ts", "// @ts-ignore", "ts-escape-hatch"),
    ("ts-expect-error is fine", "src/lib/x.ts",
     "// @ts-expect-error jsPDF ships no types for this plugin", None),
    ("explicit any", "src/lib/x.ts", "function f(doc: any) {}", "no-any"),
    ("any allowed in tests", "src/lib/x.test.ts", "function f(doc: any) {}", None),
    ("console.log", "src/lib/x.ts", "console.log(payload);", "console-log"),
    ("console.error is fine", "src/lib/x.ts", "console.error(payload);", None),
]

# route-without-auth is a file-level rule; give it its own cases.
ROUTE_CASES: list[tuple[str, str, str | None]] = [
    ("route touching db with no guard",
     'export async function POST() {\n'
     '  const c = createControlClient();\n'
     '  await c.from("tenants").delete();\n}',
     "route-without-auth"),
    ("route with getUser guard",
     'export async function POST() {\n'
     "  const { data } = await supabase.auth.getUser();\n"
     '  await supabase.from("sales").select();\n}',
     None),
    ("route with platform-admin guard",
     'export async function POST() {\n'
     "  await verifyPlatformAdmin(req);\n"
     '  const c = createControlClient();\n  await c.from("tenants").select();\n}',
     None),
    ("webhook with signature check",
     "export async function POST() {\n"
     "  const event = stripe.webhooks.constructEvent(raw, sig, secret);\n"
     '  await c.from("tenants").update({});\n}',
     None),
    ("route with no db access needs no guard",
     "export async function POST() {\n"
     '  const r = NextResponse.json({ ok: true });\n'
     '  r.cookies.delete("kaufnest_impersonating");\n  return r;\n}',
     None),
]


def check(name: str, rel_path: str, source: str, expected: str | None) -> bool:
    hits = {f.rule.id for f in scan_text(rel_path, source)}
    if expected is None:
        if hits:
            print(f"  FAIL {name}: expected clean, got {sorted(hits)}")
            return False
        return True
    if expected not in hits:
        print(f"  FAIL {name}: expected {expected!r}, got {sorted(hits) or 'nothing'}")
        return False
    return True


def guard_denies(rel_path: str, content: str) -> bool:
    """End-to-end: does the PreToolUse hook actually emit a deny for this write?"""
    event = json.dumps({
        "tool_name": "Write",
        "tool_input": {"file_path": str(REPO / rel_path), "content": content},
    })
    result = subprocess.run(
        [sys.executable, str(HERE / "guard_edit.py")],
        input=event, capture_output=True, text=True,
    )
    if not result.stdout.strip():
        return False
    payload = json.loads(result.stdout)
    return payload["hookSpecificOutput"]["permissionDecision"] == "deny"


def main() -> None:
    failures = 0

    print("rule cases:")
    for name, rel_path, source, expected in CASES:
        if not check(name, rel_path, source, expected):
            failures += 1

    print("route-without-auth cases:")
    for name, source, expected in ROUTE_CASES:
        if not check(name, "src/app/api/thing/route.ts", source, expected):
            failures += 1

    print("guard_edit end-to-end:")
    # A BLOCK rule must actually deny...
    if not guard_denies("src/middleware.ts", "export function middleware() {}"):
        print("  FAIL guard did not deny src/middleware.ts")
        failures += 1
    if not guard_denies("src/app/dashboard/p.tsx",
                        CLIENT + 'import { createControlClient } from "@/lib/supabase/control";'):
        print("  FAIL guard did not deny server import in client component")
        failures += 1
    # ...and a WARN rule must NOT deny (warnings are reported, never blocking).
    if guard_denies("src/lib/x.ts", "console.log(1);"):
        print("  FAIL guard denied a WARN-severity finding")
        failures += 1
    # Clean code must pass untouched.
    if guard_denies("src/lib/x.ts", "export const answer = 42;"):
        print("  FAIL guard denied clean code")
        failures += 1

    total = len(CASES) + len(ROUTE_CASES) + 4
    if failures:
        print(f"\n{failures}/{total} checks FAILED")
        sys.exit(1)
    print(f"\nAll {total} checks passed.")


if __name__ == "__main__":
    main()
