"""Project-invariant rules for KaufNest Dashboard, and the scanner that applies them.

This is the single source of truth for "what counts as bad code here". Two
callers consume it:

  * `guard_edit.py`  — a PreToolUse hook. Runs the BLOCK rules against the
    content Claude is about to write and denies the tool call outright.
  * `verify_changes.py` — a CLI/Stop-hook reporter. Runs *every* rule over the
    working tree's changed files and prints a findings report.

Keeping both on one rule list is the point: a rule added for the blocking hook
automatically shows up in the report, and neither can drift from the other.

Rules encode the invariants that AGENTS.md, `supabase/SKILL.md` and the
2026-07-24 audit state in prose. Prose does not fail a build; these do.

Design constraints:
  * stdlib only — the hooks run under `uv run` with no dependency resolution.
  * regex-based, not a TS parser. Every pattern was calibrated against the
    repo at commit bafa506 so a clean tree reports zero BLOCK findings; see
    each rule's `why` for what it is actually protecting.
  * false positives are escapable with a `# verifier:allow <rule-id>` (or
    `// verifier:allow <rule-id>`) comment on the offending line, so a rule
    is never a hard wall when a human has judged the case.

Run manually:  uv run .claude/verifiers/verify_changes.py
"""
import re
from dataclasses import dataclass, field
from pathlib import Path

BLOCK = "block"
WARN = "warn"

# Suppression marker, e.g.  const x: any = parsed; // verifier:allow no-any
ALLOW_RE = re.compile(r"(?://|#|--)\s*verifier:allow\s+([\w,\s-]+)")

CODE_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs")


@dataclass
class Rule:
    """One invariant.

    `pattern` matches a single line. `path_include` / `path_exclude` narrow
    which files the rule looks at. `requires_file_pattern` makes the rule
    conditional on something appearing anywhere in the file (used for the
    "use client" checks, where the offence is the *combination* of a client
    directive and a server-only import).
    """
    id: str
    severity: str
    message: str
    why: str
    pattern: re.Pattern | None = None
    path_include: tuple[str, ...] = ()
    path_exclude: tuple[str, ...] = ()
    requires_file_pattern: re.Pattern | None = None
    # File-level rules (absence checks) can't be expressed as a line match.
    file_check: str = ""
    tags: tuple[str, ...] = field(default_factory=tuple)

    def applies_to(self, rel_path: str) -> bool:
        if self.path_exclude and any(re.search(p, rel_path) for p in self.path_exclude):
            return False
        if self.path_include:
            return any(re.search(p, rel_path) for p in self.path_include)
        return True


# --------------------------------------------------------------------------
# Rule set
# --------------------------------------------------------------------------
# Ordering is roughly by blast radius: leaked credentials and tenant-isolation
# breaks first, then correctness invariants, then code-standard nits.

RULES: list[Rule] = [
    # ---- Secrets -----------------------------------------------------------
    Rule(
        id="secret-literal",
        severity=BLOCK,
        message=(
            "Hardcoded credential. Read it from process.env and put the value "
            "in .gitignore'd .env.local (document the name in .env.local.example)."
        ),
        why=(
            "Audit 2.7: real secrets already live in the working tree. A key "
            "pasted into src/ ships to git history and, for NEXT_PUBLIC_* or "
            "client bundles, to every browser."
        ),
        # Anthropic keys, Stripe live/test secrets, GitHub tokens, and the
        # service-role JWT shape Supabase issues (eyJ… header of a JWT).
        pattern=re.compile(
            r"(sk-ant-[\w-]{20,}"
            r"|sk_live_[A-Za-z0-9]{16,}"
            r"|sk_test_[A-Za-z0-9]{16,}"
            r"|whsec_[A-Za-z0-9]{16,}"
            r"|gh[pousr]_[A-Za-z0-9]{20,}"
            r"|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,})"
        ),
        path_exclude=(
            r"\.env\.local\.example$",
            r"^\.claude/settings\.local\.json$",
            # This rule's own fixtures are fake credentials by definition —
            # without this, the verifier blocks every edit to its own tests.
            r"^\.claude/verifiers/test_rules\.py$",
        ),
        tags=("security",),
    ),
    Rule(
        id="secret-env-assignment",
        severity=BLOCK,
        message=(
            "Secret assigned a literal value instead of being read from the "
            "environment. Use process.env.<NAME>."
        ),
        why="Same as secret-literal, for names the shape-based pattern misses.",
        pattern=re.compile(
            r"(SERVICE_ROLE_KEY|SERVICE_KEY|ACCESS_TOKEN|CLIENT_SECRET|API_KEY"
            r"|VERIFICATION_TOKEN|WEBHOOK_SECRET)\s*[:=]\s*[\"'][A-Za-z0-9_\-./+]{16,}[\"']"
        ),
        path_exclude=(r"\.env", r"\.md$", r"^\.claude/"),
        tags=("security",),
    ),

    # ---- Tenant isolation --------------------------------------------------
    Rule(
        id="public-schema-query",
        severity=BLOCK,
        message=(
            "Never query public.* — all tenant data lives in tenant_<slug> "
            "schemas. Use createTenantClient()/createClient(), which reads the "
            "schema from user.app_metadata.tenant_schema."
        ),
        why="AGENTS.md key rule 1. A public.* read either 404s or crosses tenants.",
        pattern=re.compile(r"""\.schema\(\s*["']public["']\s*\)|\.from\(\s*["']public\."""),
        path_include=(r"^src/.*\.tsx?$",),
        tags=("security", "tenancy"),
    ),
    Rule(
        id="hardcoded-tenant-schema",
        severity=WARN,
        message=(
            "Hardcoded tenant schema name. Read it from "
            "user.app_metadata.tenant_schema instead. (Dropshipping is the "
            "documented exception — that table exists only in tenant_kaufnest; "
            "suppress with `// verifier:allow hardcoded-tenant-schema`.)"
        ),
        why=(
            "AGENTS.md key rule 2. There are multiple live tenants; a "
            "hardcoded schema silently serves one tenant's data to all of them."
        ),
        pattern=re.compile(r"""["'`]tenant_[a-z0-9_]+["'`.]"""),
        path_include=(r"^src/.*\.tsx?$",),
        tags=("security", "tenancy"),
    ),
    Rule(
        id="migration-hardcodes-schema",
        severity=WARN,
        message=(
            "Tenant-schema DDL must go through run_on_all_tenant_schemas($$ ... "
            "{{schema}} ... $$) and be mirrored into provision_tenant_schema() "
            "in 005_tenant_provisioning.sql. See supabase/SKILL.md's 2-places rule."
        ),
        why=(
            "AGENTS.md key rule 5. Naming one schema in a migration leaves "
            "every other live tenant stale — this has bitten the project before."
        ),
        pattern=re.compile(
            r"^\s*(ALTER|CREATE|DROP)\s+(TABLE|INDEX|POLICY|TRIGGER|VIEW|TYPE)"
            r"[^;]*\btenant_[a-z0-9_]+\.",
            re.IGNORECASE,
        ),
        path_include=(r"^supabase/migrations/.*\.sql$",),
        path_exclude=(
            # 001–011 predate the helper: run_on_all_tenant_schemas was
            # introduced by 012_tenant_migration_helper.sql, and 013 backfilled
            # the tenants those earlier migrations had missed. Flagging them now
            # would be 17 findings nobody can act on — history is not fixable.
            r"^supabase/migrations/(00\d|01[01])_",
            # dropship_listings exists ONLY in tenant_kaufnest by design; both
            # dropshipping/SKILL.md and dropshipping/CLAUDE.md say explicitly to
            # target that schema directly and NOT to use the helper.
            r"^supabase/migrations/\d+_dropship",
        ),
        tags=("tenancy", "migrations"),
    ),

    # ---- Server/client boundary -------------------------------------------
    Rule(
        id="server-module-in-client",
        severity=BLOCK,
        message=(
            'This file is a Client Component ("use client") but imports a '
            "server-only module. Move the call into a Server Component, a "
            "route handler, or a thunk that fetches from /api/*."
        ),
        why=(
            "AGENTS.md key rule 3 + src/lib/integrations/SKILL.md. These "
            "modules close over the service-role key and OAuth tokens; "
            "importing one from a client file bundles secrets into the browser."
        ),
        pattern=re.compile(
            r"""from\s+["'](@/lib/supabase/(server|control)"""
            r"""|@/lib/integrations[^"']*|@/lib/stripe|stripe)["']"""
        ),
        requires_file_pattern=re.compile(r"""^\s*["']use client["']"""),
        path_include=(r"^src/.*\.tsx?$",),
        tags=("security", "nextjs"),
    ),
    Rule(
        id="server-secret-in-client",
        severity=BLOCK,
        message=(
            "Server-only environment variable referenced from a Client "
            "Component. Only NEXT_PUBLIC_* vars are safe here."
        ),
        why=(
            "Anything read in a client file is inlined into the JS bundle at "
            "build time. A service-role key there is a full RLS bypass handed "
            "to every visitor."
        ),
        pattern=re.compile(r"process\.env\.(?!NEXT_PUBLIC_)[A-Z_][A-Z0-9_]*"),
        requires_file_pattern=re.compile(r"""^\s*["']use client["']"""),
        path_include=(r"^src/.*\.tsx?$",),
        tags=("security", "nextjs"),
    ),
    Rule(
        id="middleware-file",
        severity=BLOCK,
        message=(
            "Do NOT create src/middleware.ts — this Next.js version uses "
            "src/proxy.ts, and having both crashes the dev server. Edit "
            "src/proxy.ts instead."
        ),
        why="AGENTS.md states this explicitly; the failure mode is a dev-server crash.",
        pattern=re.compile(r".", re.DOTALL),
        path_include=(r"^src/middleware\.tsx?$",),
        tags=("nextjs",),
    ),

    # ---- Billing / data-integrity -----------------------------------------
    Rule(
        id="plan-write-outside-webhook",
        severity=WARN,
        message=(
            "control.tenants.plan is owned by the Stripe webhook. Writing it "
            "anywhere else makes billing state diverge from Stripe, and the "
            "next webhook silently overwrites you."
        ),
        why=(
            "AGENTS.md key rule 4. Scoped to `plan` only, not `status`: the "
            "admin tenant-status lifecycle (active/suspended, see "
            "docs/superpowers/plans/2026-07-01-tenant-status-lifecycle.md) is a "
            "deliberate non-Stripe writer of `status`, so flagging that column "
            "would be permanent noise."
        ),
        pattern=re.compile(r"""\.update\(\s*\{[^}]*\bplan\s*:"""),
        path_include=(r"^src/.*\.tsx?$",),
        path_exclude=(r"^src/app/api/billing/webhook/",),
        tags=("billing",),
    ),

    # ---- API-surface hygiene ----------------------------------------------
    Rule(
        id="db-error-to-client",
        severity=WARN,
        message=(
            "Returning a raw Postgres/Supabase error message to the client "
            "leaks schema internals. Log it server-side and return a generic "
            "message."
        ),
        why="Audit 2.7 (open finding) — several routes still do this.",
        pattern=re.compile(
            r"""NextResponse\.json\(\s*\{[^}]*\b(detail|error|message)\s*:\s*"""
            r"""\w+(\.\w+)*\.message"""
        ),
        path_include=(r"^src/app/api/.*route\.tsx?$",),
        tags=("security", "api"),
    ),
    Rule(
        id="route-without-auth",
        severity=WARN,
        message=(
            "Route handler touches Supabase but calls no auth guard. Expected "
            "one of: supabase.auth.getUser(), verifyPlatformAdmin, "
            "requireIntegrationAdmin, requireBillingAdmin, or a webhook "
            "signature check."
        ),
        why=(
            "Audit 2.1: the one route that skipped its authenticity check was "
            "an unauthenticated destructive webhook. This catches the next one."
        ),
        file_check="route_auth",
        path_include=(r"^src/app/api/.*route\.tsx?$",),
        tags=("security", "api"),
    ),

    # ---- Code standards ----------------------------------------------------
    Rule(
        id="ts-escape-hatch",
        severity=WARN,
        message=(
            "@ts-ignore / @ts-nocheck disables type checking. Use @ts-expect-error "
            "with a reason, or fix the type."
        ),
        why="pre-commit runs `tsc --noEmit`; these silently opt out of that gate.",
        pattern=re.compile(r"@ts-(ignore|nocheck)\b"),
        path_include=(r"^src/.*\.tsx?$",),
        tags=("standards",),
    ),
    Rule(
        id="no-any",
        severity=WARN,
        message="Explicit `any` defeats the type system — prefer `unknown` plus a narrow.",
        why="src/types/index.ts is the documented single source of truth for domain types.",
        pattern=re.compile(r":\s*any\b(?!\])"),
        path_include=(r"^src/.*\.tsx?$",),
        path_exclude=(r"\.test\.tsx?$",),
        tags=("standards",),
    ),
    Rule(
        id="dangerous-html",
        severity=WARN,
        message=(
            "dangerouslySetInnerHTML is an XSS sink. Sanitize the value or "
            "render it as text."
        ),
        why="Listing/message bodies come from eBay — i.e. from untrusted sellers and buyers.",
        pattern=re.compile(r"dangerouslySetInnerHTML"),
        path_include=(r"^src/.*\.tsx?$",),
        tags=("security",),
    ),
    Rule(
        id="console-log",
        severity=WARN,
        message="Leftover console.log — use console.error/warn for real diagnostics or drop it.",
        why="Keeps server logs meaningful and avoids leaking payloads into browser consoles.",
        pattern=re.compile(r"\bconsole\.log\("),
        path_include=(r"^src/.*\.tsx?$",),
        path_exclude=(r"\.test\.tsx?$",),
        tags=("standards",),
    ),
]

RULES_BY_ID = {r.id: r for r in RULES}


# --------------------------------------------------------------------------
# Scanner
# --------------------------------------------------------------------------
@dataclass
class Finding:
    rule: Rule
    path: str
    line_no: int
    line: str

    def format(self) -> str:
        excerpt = self.line.strip()
        if len(excerpt) > 100:
            excerpt = excerpt[:100] + "…"
        return (
            f"{self.path}:{self.line_no} [{self.rule.id}] {self.rule.message}\n"
            f"    | {excerpt}"
        )


def _marks(line: str, rule_id: str) -> bool:
    match = ALLOW_RE.search(line)
    if not match:
        return False
    return rule_id in {token.strip() for token in match.group(1).split(",")}


def _suppressed(lines: list[str], index: int, rule_id: str) -> bool:
    """True when this line, or the line above it, carries the allow marker.

    Same-line is the common form. The preceding-line form exists because the
    marker often *cannot* go on the offending line: inside a JSX opening tag
    (`dangerouslySetInnerHTML={{` on its own line) or a multi-line SQL
    statement, there is no legal place to put a trailing comment. This mirrors
    `eslint-disable-next-line`, which developers already reach for by reflex.
    """
    if _marks(lines[index], rule_id):
        return True
    return index > 0 and _marks(lines[index - 1], rule_id)


# Any one of these is accepted as "this handler authenticates its caller".
_AUTH_MARKERS = re.compile(
    r"auth\.getUser\(\)|verifyPlatformAdmin|requireIntegrationAdmin|requireBillingAdmin"
    r"|requirePermission|verifySignature|constructEvent|verifyNotificationSignature"
)
# Only routes that actually reach data need a guard; a cookie-clearing route
# (e.g. admin/exit-impersonation) legitimately has none.
_DATA_ACCESS = re.compile(
    r"createClient\(|createTenantClient\(|createControlClient\("
    r"|createServiceClientForTenant\(|\.from\("
)


def _route_auth_finding(rule: Rule, rel_path: str, text: str) -> list[Finding]:
    if not _DATA_ACCESS.search(text):
        return []
    if _AUTH_MARKERS.search(text):
        return []
    if "verifier:allow route-without-auth" in text:
        return []
    return [Finding(rule=rule, path=rel_path, line_no=1, line="(whole file)")]


def scan_text(rel_path: str, text: str, severities: tuple[str, ...] = (BLOCK, WARN)) -> list[Finding]:
    """Apply every applicable rule to one file's content.

    `rel_path` must be repo-relative — path_include/path_exclude patterns are
    anchored against that form (e.g. `^src/app/api/`).
    """
    # Normalise to a bare repo-relative path. NOT lstrip("./") — that strips a
    # *character set*, so a dotfile like ".env.local.example" would come out as
    # "env.local.example" and silently miss every path rule anchored on the dot.
    rel_path = rel_path.replace("\\", "/")
    if rel_path.startswith("./"):
        rel_path = rel_path[2:]
    findings: list[Finding] = []
    lines = text.splitlines()

    for rule in RULES:
        if rule.severity not in severities or not rule.applies_to(rel_path):
            continue

        if rule.file_check == "route_auth":
            findings.extend(_route_auth_finding(rule, rel_path, text))
            continue

        if rule.requires_file_pattern and not rule.requires_file_pattern.search(text):
            continue
        if rule.pattern is None:
            continue

        for index, line in enumerate(lines):
            if rule.pattern.search(line) and not _suppressed(lines, index, rule.id):
                findings.append(
                    Finding(rule=rule, path=rel_path, line_no=index + 1, line=line)
                )

    return findings


def scan_file(root: Path, rel_path: str, severities: tuple[str, ...] = (BLOCK, WARN)) -> list[Finding]:
    target = root / rel_path
    if not target.is_file():
        return []
    try:
        text = target.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    return scan_text(rel_path, text, severities)
