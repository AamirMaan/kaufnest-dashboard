## SaaS migration (in progress)

This project is being converted to a multi-tenant SaaS product. The full plan
is in `SAAS_MIGRATION.md` — read it before touching auth, Supabase clients, or
the admin panel. Phases 1–6 are scaffolded in code. Project A (control plane)
and `tenant_kaufnest` (Project B's first tenant — schema, data, RLS, grants,
client routing) are **already provisioned live**, and
`005_tenant_provisioning.sql` (the `provision_tenant_schema()`/
`set_user_tenant()` functions Phase 4 dynamic provisioning depends on) is
**applied**.

**`supabase/SKILL.md`'s file-map table is the single source of truth for
migration apply-status** — do not duplicate a specific "outstanding: X, Y, Z"
list here, it will drift out of sync with that table as new migrations are
added (this happened once already — see the 2026-07-24 audit — and the fix
was to stop maintaining two lists instead of just re-syncing them). That
table itself is **unverified against the live databases** (this repo has no
migration ledger yet); confirm actual apply-status there directly before
relying on it for anything load-bearing.

Stripe billing (2026-08-29) is wired end-to-end — self-serve checkout,
plan changes, and cancellation, with the webhook as the sole writer of
`plan`/`status`. See `src/app/api/billing/` and
`docs/superpowers/specs/2026-08-29-stripe-billing-design.md`.

**Key rules that apply once Phase 3 DB migration is live:**
1. Never query `public.*` — all tenant data lives in `tenant_<slug>` schemas.
2. Never hardcode a schema name — read it from `user.app_metadata.tenant_schema`.
3. Control plane client (`createControlClient`) is server-only — never in Client Components.
4. Stripe webhooks are the source of truth for `plan`/`status` — never write those directly from UI.
5. **Tenant schema DDL must use `run_on_all_tenant_schemas`** — never write
   `ALTER TABLE tenant_kaufnest.*` directly in a new migration. There are
   multiple live tenants (see `supabase/SKILL.md`'s intro for the current
   named list — treat that as the source of truth, not a count repeated
   here); hardcoding one schema name leaves the rest stale. Use:
   ```sql
   SELECT public.run_on_all_tenant_schemas($$
     ALTER TABLE {{schema}}.sales ADD COLUMN IF NOT EXISTS …;
   $$);
   ```
   Also update `provision_tenant_schema()` in `005_tenant_provisioning.sql`
   for new tenants. See `supabase/SKILL.md` for the full 2-places rule.

New shared code from the migration:
- `src/lib/supabase/control.ts` — control plane (Project A) client
- `src/proxy.ts` — existing route-protection proxy (this Next.js version's
  middleware equivalent — do NOT add `src/middleware.ts`, having both crashes
  the dev server), updated for tenant-aware RBAC profile lookups
- `src/store/slices/companyProfileSlice.ts` — per-tenant company profile state
- `src/lib/stripe.ts` (Stripe client + `PLANS` price-ID map) +
  `src/lib/utils/planGating.ts` (feature gates) +
  `src/lib/utils/pricing.ts` (the three paid plans' prices/copy, feature
  ticks derived from `planGating.ts`) — billing helpers
- `src/app/admin/` — Boughtopia platform admin panel (`/admin`)
- `src/app/api/admin/` — provision/impersonate/list API routes
- `src/app/api/billing/` — checkout, change-plan, cancel, status, and
  webhook routes. The webhook is the only writer of `control.tenants.plan`/
  `status`; the other four only talk to Stripe.
- `src/components/billing/PlanPicker.tsx` — shared plan-picker cards, used
  by `/trial-expired` and Settings' Billing section
- `src/lib/billing/authGuard.ts` — `requireBillingAdmin()`, gates the
  mutating billing routes to `admin`/`super_admin`
- `src/lib/integrations/` — eBay/Amazon OAuth adapters + order-sync pipeline
  (server-only, never imported client-side — see its `SKILL.md`)
- `src/app/api/integrations/` — connect/callback/disconnect/review/import
  routes. Order sync is **manual only**, via the Integrations feature's
  "Review Orders" page — there is no scheduled/cron sync route (a
  `src/app/api/cron/sync-integrations/` route was previously documented here
  and in `.env.local.example`'s `CRON_SECRET`, but neither the route nor a
  `vercel.json` crons entry was ever implemented; removed as of the
  2026-07-24 audit rather than left as a dead reference)
- **`src/app/api/notifications/` is NOT the in-app notifications feature** —
  it's the pre-existing eBay Marketplace Account Deletion webhook
  (`src/app/api/notifications/ebay-account-deletion/route.ts`). The naming
  is an unfortunate collision. In-app notifications (bell, unread state, the
  `notifications`/`notification_reads` tables) have no API routes at all —
  the client reads/writes `notifications`/`notification_reads`/
  `profiles.notifications_read_through` directly via `createTenantClient()`,
  gated entirely by RLS (see `src/lib/utils/notifications.ts`,
  `src/store/slices/notificationsSlice.ts`,
  `src/components/layout/NotificationBell.tsx`). Do not add new routes under
  `src/app/api/notifications/` for the bell feature — put anything
  server-side notifications need elsewhere and cross-reference it from
  `src/app/dashboard/CLAUDE.md` instead.
- **Pagination architecture (Phase 3):** All main data tables use server-side
  pagination. Layout (`src/app/dashboard/layout.tsx`) hydrates page 1 with a
  row count via `.select("*", { count: "exact" }).range(0,
  DEFAULT_PAGE_SIZE - 1)` and passes `{data, count}` through `StoreProvider`
  → each slice's `hydratePage` reducer. Per-feature fetch thunks
  (`fetchSalesPage`, `fetchExpensesPage`, `fetchPurchasesPage`,
  `fetchAuditLogsPage`, `fetchInventoryPage`) handle subsequent pages and
  filter changes — filters are pushed into the Supabase query (`gte`, `lte`,
  `eq`, `ilike`), not applied client-side. Shared helpers:
  `src/lib/utils/pagedQuery.ts` (`rangeFor`, `PageRequest`,
  `DEFAULT_PAGE_SIZE = 50`) and `src/components/ui/Pagination.tsx`. Inventory
  has a split fetch: paginated `items` for the table + a lightweight
  full-fetch `selectorItems` (`id, name, current_stock, sku`) for product
  dropdowns in modals. Users and dropshipping listings use client-side
  pagination only (small data sets).
- `src/lib/ai/` — Anthropic client, prompt builders, quota metering and the
  AI route guard (server-only, never imported client-side). Quota lives in
  `control.tenant_ai_usage` (Project A); the per-plan allowance is
  `aiGenerationsPerMonth` in `lib/utils/planGating.ts`. AI visibility is
  `control.tenants.ai_enabled`, toggled per tenant from `/admin`.
- `src/app/api/listings/ai/` — describe, aspects and usage routes.
- `src/lib/utils/sanitizeListingHtml.ts` — eBay-safe HTML allowlist, applied
  in `publishPayloads.ts` before either description field reaches eBay.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working agreement — how we proceed

## During development (feature work)

- **Don't start the dev server yourself or `curl` routes to verify functionality**
  (i.e. don't shell out to `next dev`/`curl`). Instead, add/extend unit tests in the
  feature's `_store/` (or `_components/`/lib) folder alongside the code you changed.
  If the Playwright MCP server (`.mcp.json`) is connected and `npm run dev` is
  already running, using it to drive a real browser for verification is fine and
  encouraged — that's a connected tool, not the agent starting a server. Otherwise,
  ask the user to manually exercise the feature in the browser and report back what
  they see.
- **Running unit tests yourself is fine and encouraged** — run the focused
  `npx jest <path>` for whatever you just changed (not the whole suite) to verify
  your own work before committing, instead of asking the user to run it and paste
  output back. Always target the specific worktree/directory you're actually
  working in — running from the wrong checkout (e.g. the main repo root when your
  changes are only in a feature worktree) silently tests stale code.
- **Still don't run `npx tsc --noEmit` or `npm run lint` mid-task** just to check
  your work — `.husky/pre-commit` already runs both automatically on every
  `git commit` and will fail the commit if either catches something. Fix what it
  reports and re-run the same `git commit` command.

## Unit tests — when to write them

Write or extend tests whenever you:
- Add a new utility function or pure helper (e.g. in `lib/utils/` or a colocated
  `_components/*.ts` pure module)
- Add a new Redux slice action or change reducer logic
- Add import/export logic, validation, or data-transformation code

Tests live next to the code they cover (`*.test.ts` / `*.test.tsx`). `jest.config.ts`
discovers any `src/**/*.test.ts(x)`. Keep tests pure (no Supabase/Redux deps where
possible) — the CSV helpers, `productOptions.ts`, `vatAmountFromGross`, etc. are all
good examples of the kind of logic that deserves a test.

## Form conventions — always enforced, not optional polish

**A mutating button must never look clickable when it can't succeed, and
must never look idle while its request is in flight.** This applies to
every create/edit form in the app, existing or new — it was already the
convention almost everywhere (every Add/Edit modal in Sales, Expenses,
Purchases, Users, Inventory follows it); `EditLiveListing.tsx`
(`dashboard/listings/`) was found not to (2026-09-01, Save Changes stayed
clickable with empty required fields) and was fixed to match. Don't let a
new page or modal be the next exception.

Concretely, every such form does all of these:
- **Wrap the fields in a real `<form id="..." onSubmit={handleSubmit}>`** —
  never a bare `<div>` with the submit button's `onClick` calling the
  handler directly. The `<form>` is what makes native HTML5 validation
  (below) actually block submission.
- **Every field marked `required` on its `<Field required>` label must ALSO
  carry the `required` attribute on the underlying `<Input>`/`<Select>`/
  `<Textarea>`.** `<Field required>` only draws the visual `*` — it does not
  propagate `required` to the control inside it. Passing both is not
  redundant; the label is cosmetic; the attribute is what blocks submission.
- **The submit button is `type="submit" form="<id>"`, not `type="button"
  onClick={...}`** — this is what lets it live outside the `<form>` (e.g.
  next to a Cancel/Delete button) while still participating in its native
  validation and submit event.
- **The submit button is `disabled` both while saving AND while the form is
  known-invalid** — compute a plain `isFormValid` boolean from current field
  state (no library needed; see `EditLiveListing.tsx` for a real example:
  title/description non-empty, price > 0, quantity ≥ 1, image URLs present,
  every required aspect filled) and use `disabled={saving || !isFormValid}`.
  Native `required` alone is not enough — it blocks the click from
  submitting, but leaves the button rendered as if it were clickable, which
  is exactly the bug this section exists to prevent.
- **While a mutation is in flight, show it**: swap the button's label to a
  busy verb ("Saving…", "Deleting…") and disable it (`disabled={saving}`,
  matching the shared `DeleteConfirmModal`'s `confirmingLabel` pattern for
  destructive actions). For a full-page load (not inside a modal), also
  show a spinning icon next to the loading text —
  `<Loader2 size={16} className="animate-spin" />` (or the page's own
  action icon, e.g. `RefreshCw`, for an inline button's busy state) — not
  bare "Loading…" text with no visual motion.

## Mandatory docs update — SKILL.md and CLAUDE.md

**After every feature edit, you MUST update the affected feature's docs before
finishing — no exceptions.** This is the project's context cache; skipping it means
the next agent re-derives everything from scratch.

- **CLAUDE.md** — update the file map whenever a file is added, removed, or
  renamed; update shared-deps list when a new shared utility is used; update any
  data-flow description that changed.
- **SKILL.md** — add or update the minimal-file-set entry for the change type you
  just made; add a Gotcha entry for any non-obvious constraint, TypeScript quirk,
  or pattern you had to figure out.

Both files should be committed in the **same commit** as the code change, not as a
follow-up.

## Branching — always work on a branch

**Never commit directly to `main`.** Before starting any task — feature, fix,
or any other change — always sync from main first, then create a new branch:

```bash
git checkout main
git pull
git checkout -b <type>/<short-description>
# e.g. feat/tenant-edit, fix/ebay-callback-redirect
```

This ensures every branch starts from the latest state of `main`, preventing
stale-base conflicts and keeping the diff clean for review.

Push the branch and open a Pull Request when the work is ready. The
repository has branch protection on `main` — direct pushes will be rejected.

## Commit and push gates

Enforced automatically by Husky git hooks (`.husky/pre-commit` and
`.husky/pre-push`) — no manual steps required. If a hook fails, fix the
reported errors before retrying the commit or push.

| Gate | Runs | Catches |
| --- | --- | --- |
| `.husky/pre-commit` | `tsc --noEmit`, `eslint`, **project verifier** | types, style, invariant violations |
| `.husky/pre-push` | `jest`, `next build` | behaviour, build breakage |

## Project verifier — the invariants above are enforced, not just documented

The "key rules" in this file (never query `public.*`, never hardcode a schema
name, control-plane client is server-only, Stripe owns `plan`, tenant DDL goes
through `run_on_all_tenant_schemas`) are all perfectly valid TypeScript when
violated. They type-check, they lint, they build, and they ship a data leak. So
they are also encoded as executable rules in **`.claude/verifiers/`**:

- **`guard_edit.py`** (PreToolUse hook) — *denies* a Write/Edit that would
  hardcode a credential, query `public.*`, import a server-only module into a
  `"use client"` file, read a non-`NEXT_PUBLIC_` env var in a Client Component,
  or create `src/middleware.ts`. The bad code never lands.
- **`verify_changes.py`** (Stop hook + CLI + pre-commit) — reports the
  judgement-call findings: `tenants.plan` written outside the Stripe webhook, a
  raw Postgres error returned to a client, a route handler reaching Supabase
  with no auth guard, `any`, `@ts-ignore`, stray `console.log`.

```bash
uv run .claude/verifiers/verify_changes.py          # findings in your diff
uv run .claude/verifiers/verify_changes.py --all    # whole-repo baseline
uv run .claude/verifiers/test_rules.py              # the rules' own tests
```

Suppress a judged exception with `// verifier:allow <rule-id>` (or `--` in SQL)
on the offending line. **See `.claude/verifiers/README.md`** for the full rule
table, the current known baseline, and how to add a rule. If you add an
invariant to this file, add the matching rule there too — a rule that only
exists as prose is one nobody enforces.

## Keeping the graphify graph current

`graphify update .` now runs **automatically** in the background at the end of
any turn that changed extractable source, via the `refresh_graphify.py` Stop
hook (AST-only, no LLM, no API cost). You no longer need to run it by hand.

Two things that are still manual:
- **Community labels** — the auto-refresh passes `--no-cluster`, so community
  names go stale after a large refactor. Run `graphify cluster-only .` when
  they stop making sense.
- **Anything outside a Claude Code session** (a rebase, a colleague's merge) —
  the hook only fires on turns, so run `graphify update .` yourself after those.

# Project structure: feature folders

Boughtopia Dashboard is a Next.js App Router app (Supabase + Redux Toolkit). To
keep changes isolated and cheap to make, **each feature's page, components,
state, and tests are colocated in one folder** under `src/app/...`, using
Next.js private folders (`_components/`, `_store/` — the leading underscore
opts them out of routing per the App Router docs at
`node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md`).

**Before editing a feature, open its folder's `CLAUDE.md` and `SKILL.md` first.**
They name the exact files to touch for common changes — you should rarely need
to explore outside that folder plus the shared dependencies it lists.

**After editing a feature, if you learned something important** — a new
gotcha, a changed data-flow pattern, a moved/renamed file, a new shared
dependency — update that feature's `SKILL.md` (and `CLAUDE.md` if the file map
changed) before you finish. Treat these docs as the project's context cache:
keeping them current means the next agent (or your future self) picks up where
you left off instead of re-deriving everything from scratch.

## Feature folders

| Folder | Route | Owns |
| --- | --- | --- |
| `src/app/(auth)/` | `/login`, `/forgot-password`, `/set-password` | auth pages (+ related `app/auth/callback`, `app/api/users/invite` routes) |
| `src/app/dashboard/` | `/dashboard` (Overview) | shell-level layout/data-hydration + overview stats — see its `CLAUDE.md` for the full feature table |
| `src/app/dashboard/sales/` | `/dashboard/sales`, `/dashboard/sales/[id]` | sales records ("Orders" in UI) + `salesSlice`; [id] is order-detail page |
| `src/app/dashboard/expenses/` | `/dashboard/expenses` | expense records + `expensesSlice` |
| `src/app/dashboard/purchases/` | `/dashboard/purchases` | inventory purchases + `purchasesSlice` |
| `src/app/dashboard/inventory/` | `/dashboard/inventory` | product catalog + stock levels + `inventorySlice` (linked from Purchases/Sales; stock synced via DB triggers) |
| `src/app/dashboard/users/` | `/dashboard/users` | user invites/roles/permission overrides/deactivation + `usersSlice` |
| `src/app/dashboard/audit-logs/` | `/dashboard/audit-logs` | activity-trail viewer (slice is shared, see below) |
| `src/app/dashboard/settings/` | `/dashboard/settings` | invoice template settings (thin — no private state) |
| `src/app/dashboard/integrations/` | `/dashboard/integrations` | eBay/Amazon platform connections + `integrationsSlice` (Pro/Business plans only; admin/super_admin only) |
| `src/app/dashboard/planner/` | `/dashboard/planner` | order/inventory planning tools |
| `src/app/dashboard/dropshipping/` | `/dashboard/dropshipping` | dropshipping supplier listings + sync |
| `src/app/dashboard/listings/` | `/dashboard/listings` | eBay listing creation (draft → publish) + `listingsSlice` (Pro/Business plans only; `manage_listings` permission) |
| `src/app/dashboard/messages/` | `/dashboard/messages` | eBay buyer message sync/reply + `messagesSlice` (Pro/Business plans only; `manage_messages` permission) |

Each feature folder follows the same shape (where it has private code):

```
<feature>/
  page.tsx
  _components/   # feature-only modals/UI
  _store/        # feature-only Redux slice + its colocated test
  _lib/          # feature-only pure helpers + their colocated tests
  CLAUDE.md      # file map, data-flow pattern, shared deps, test command
  SKILL.md       # agent playbook: minimal file set per change type, gotchas
```

`_lib/` is for pure logic a feature owns but that isn't Redux state — the
maths, validation and grouping a page would otherwise inline. It exists in
`dashboard/` (`aggregateSales`, `platformBalance`), `messages/`
(`groupThreads`), `planner/` (`calculations`, `fees`), `listings/`
(`wizardValidation`) and `users/` (`userStatusGuards`). Extracting into `_lib/`
is what lets the logic be unit-tested without rendering the page, so **new
non-trivial page maths belongs here, with a colocated test** — not inline in
`page.tsx`.

## Shared vs. feature-private — how the split was decided

A piece of code stays in a top-level shared folder only if it's used by **3+
features or only in core wiring**; otherwise it moves into the one feature that
owns it. Current shared locations:

- `src/components/ui/*` — generic primitives (Button, Modal, DataTable,
  FilterBar, Badge, Toast, FormFields, StatCard, ThemeProvider)
- `src/components/layout/*` — app shell (DashboardShell, Sidebar, PageHeader)
- `src/components/modals/{DeleteConfirmModal,InvoiceModal}` — used by Sales,
  Expenses, and Purchases
- `src/store/{store.ts,hooks.ts,StoreProvider.tsx}` + `src/store/slices/{auditLogsSlice,currentUserSlice}`
  — `auditLogsSlice` is written to by every CRUD feature; `currentUserSlice` is
  read directly by Sales/Expenses/Purchases for role checks
- `src/lib/*` — Supabase clients, `utils/{audit,currency,date,filters,permissions,generateInvoice}`
  (`generateInvoice` is also used by the shared `InvoiceModal`, both read
  company/invoice settings from `src/store/slices/companyProfileSlice`)
- `src/types/index.ts` — single source of truth for all domain types

Two routes are conceptually part of a feature but **cannot** be colocated
because Next.js pins them to fixed URL paths: `app/api/users/invite/route.ts`
(Users) and `app/auth/callback/route.ts` (Auth). Each is cross-referenced from
its feature's `CLAUDE.md`.

## Tests

Tests are colocated with the code they cover (`*.test.ts` next to the slice or
lib file it tests) — `jest.config.ts` discovers any `src/**/*.test.ts(x)`. Run
a single feature's tests with `npx jest dashboard/<feature>`.
