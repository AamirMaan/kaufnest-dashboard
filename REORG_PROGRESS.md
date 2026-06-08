# Feature-folder reorg — working plan & progress tracker

> Scratch file for an in-progress restructuring. Delete once all checkboxes are done and verification passes.

## Goal
Colocate each feature's page, components, Redux slice, and tests under its own
`src/app/dashboard/<feature>/` (or `(auth)/`) folder using Next.js private `_folders`
(`_components/`, `_store/`), add `CLAUDE.md` + `SKILL.md` per feature, move shared-lib
tests next to the code they test, and update root `AGENTS.md` with a project map.
Full rationale in the approved plan (also pasted below for resilience).

## Feature-private vs shared (decided — do not re-litigate)
- MOVES into feature folders: salesSlice/expensesSlice/purchasesSlice/usersSlice,
  their Add*/Edit* modals, AuditLogDetailModal
- STAYS shared: auditLogsSlice, currentUserSlice, DeleteConfirmModal, InvoiceModal,
  useInvoiceSettings, generateInvoice, writeAuditLog, permissions/currency/date/filters,
  supabase clients, components/ui/*, components/layout/*, types
- CANNOT move (Next.js route requirement): app/api/users/invite/route.ts,
  app/auth/callback/route.ts — cross-reference from users/CLAUDE.md instead

## Checklist (check off as completed; re-grep before checking "imports fixed")

### Sales — DONE
- [x] git mv salesSlice.ts → app/dashboard/sales/_store/
- [x] git mv Add/EditSaleModal.tsx → app/dashboard/sales/_components/
- [x] fix imports (page.tsx relative to ./_components, ./_store; modals → ../_store/salesSlice; store.ts/StoreProvider.tsx → @/app/dashboard/sales/_store/salesSlice)
- [x] split sales describe-block out of __tests__/business/slices.test.ts → _store/salesSlice.test.ts
- [x] write sales/CLAUDE.md + sales/SKILL.md

### Expenses, Purchases, Users, Audit logs, Shared-lib tests, jest config — ALL DONE
(same pattern as Sales: git mv slice+modals into feature folder, relative imports
within feature, @/ alias updates in store.ts/StoreProvider.tsx, split test file,
CLAUDE.md+SKILL.md written; auditLogsSlice stayed shared per plan; currency/permissions/
date tests moved next to their lib files & renamed; old __tests__ tree deleted;
jest.config.ts testMatch now <rootDir>/src/**/*.test.ts(x))

### Settings — REMAINING
- [ ] write settings/CLAUDE.md (note useInvoiceSettings/generateInvoice stay shared — InvoiceModal depends on them too) + SKILL.md
  (no file moves — settings has no feature-private code beyond page.tsx)

### Config & root docs — REMAINING
- [ ] write src/app/dashboard/CLAUDE.md + SKILL.md (shell map + links to feature folders)
- [ ] write src/app/(auth)/CLAUDE.md + SKILL.md
- [ ] add "Project structure" section to AGENTS.md (feature convention, folder map, "read the feature's CLAUDE.md/SKILL.md first")

### Final verification
- [x] re-grep for stale paths: @/components/modals/{Add,Edit}*Modal, @/components/modals/AuditLogDetailModal, @/store/slices/{sales,expenses,purchases,users}Slice, __tests__/business — clean, zero matches
- [x] npm test  (all suites discovered + passing) — 96/96 passing across 8 suites
- [x] npx tsc --noEmit  (no broken imports) — 1 pre-existing error found (login/page.tsx missing default export, caused by user's own uncommitted edit predating this session) — restored the wrapper at user's direction; now clean
- [x] npm run lint — 18 errors / 3 warnings, ALL pre-existing (StoreProvider ref-init pattern unchanged since commit 8cf2166; Edit*Modal setState-in-effect identical pre-move; ThemeProvider is the user's own new untracked file). None introduced by the reorg.
- [ ] npm run dev — click through every dashboard route + auth flows, exercise modals (open/save/delete)
- [ ] delete this REORG_PROGRESS.md file once everything above is green

---

## Full plan detail (reference — target tree & doc-content guidance)

### Target structure (pattern repeats per feature)
```
src/app/dashboard/sales/
  page.tsx
  _components/AddSaleModal.tsx EditSaleModal.tsx
  _store/salesSlice.ts salesSlice.test.ts
  CLAUDE.md  SKILL.md
```
Same for expenses, purchases, users (+ api/users/invite/route.ts cross-ref), audit-logs
(+ auditLogsSlice cross-ref to shared store/slices/), settings (+ cross-ref to shared
useInvoiceSettings/generateInvoice). `(auth)` and `dashboard/` (shell level) each get
their own CLAUDE.md + SKILL.md too.

### Import convention
- Within a feature folder: relative imports (matches existing `./Sidebar` convention in
  DashboardShell.tsx) — e.g. AddSaleModal.tsx → `../_store/salesSlice`, page.tsx →
  `./_components/AddSaleModal`
- Far-away consumers (store.ts, StoreProvider.tsx): `@/` alias to the new path, e.g.
  `@/app/dashboard/sales/_store/salesSlice`

### CLAUDE.md per feature should cover
What it does + route, file map (page/_components/_store), Redux↔Supabase data-flow
pattern (dispatch local update → writeAuditLog), shared deps it pulls in and why they
live outside, where its tests are + how to run them (`npx jest app/dashboard/sales`).

### SKILL.md per feature
Frontmatter (`name`, `description`) + a direct playbook: read this folder's CLAUDE.md
first, minimal file set for a typical change, test command, feature-specific gotchas.

### Root AGENTS.md addition
"Project structure" section: feature-folder convention explained, list of feature
folders with paths, instruction to read the feature's CLAUDE.md/SKILL.md before editing
rather than exploring the whole tree.

---

## Feature roadmap — future work (separate from this reorg, tracked here for continuity)

> Once the reorg above is fully checked off and this file is deleted, copy this
> roadmap section into AGENTS.md (or a dedicated ROADMAP.md) so it isn't lost.

5 phases, in order:

- **MVP (Done)** — existing foundation: auth, roles, multi-platform sales/expenses/
  purchases, monthly overview, audit log, user management.
- **Phase 1 (Up Next)** — Dynamic totals on filtered views + a proper dashboard with
  time-range filters and stat cards. Highest-value, lowest-complexity work to do next —
  **recommended starting point**, since slicing data by time period is foundational and
  almost everything else builds on it.
- **Phase 2 (Near Term)** — VAT calculations for purchases and sales, multi-rate
  support, VAT summary reports for filing, and CSV/PDF export.
- **Phase 3 (Future)** — Budget planner with actuals vs. plan, profit targets, cash
  flow forecasting, and inventory reorder planning.
- **Phase 4 (AI & Advanced)** — AI tax saving suggestions, anomaly alerts, business
  plan assistant, platform optimisation, and natural language querying of your data.
