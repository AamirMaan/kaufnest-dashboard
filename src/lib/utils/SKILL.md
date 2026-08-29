---
name: lib-utils
description: Reference for every shared utility module in src/lib/utils (audit, csv, currency, date, detectPlatform, excel, filters, generateInvoice, invoiceMath, localeParse, pagedQuery, permissions, planGating, validation) — use this instead of opening the source files when you need to know what a helper does, its signature, or where it's used.
---

# Shared utilities (`src/lib/utils/`)

Pure-function helpers used across Sales/Expenses/Purchases/Users/Audit Logs.
They're shared because 3+ features depend on them — see the root `AGENTS.md`
"shared vs. feature-private" rule before moving anything into or out of here.
Each module (except `generateInvoice.ts`) has a colocated `*.test.ts` — run
them with `npx jest lib/utils`.

## audit.ts

`export async function writeAuditLog(supabase, params: WriteAuditLogParams)`
→ `Promise<AuditLog | null>`.

- `params`: `{ userId, userEmail, action: AuditAction, entityType: AuditEntity, entityId?, metadata? }`.
- Inserts into the `audit_logs` table and returns the inserted row via
  `.select().single()`.
- **Does not throw** — errors are swallowed (destructures only `data`, not
  `error`) so a logging failure never blocks the primary CRUD action. Don't
  wrap calls in `try/catch` expecting to handle audit failures; there's
  nothing to catch.
- Every create/update/delete across Sales/Expenses/Purchases/Users calls this
  *and* dispatches `addAuditLog(...)` to the shared `auditLogsSlice` — both
  halves are required (DB row for persistence, Redux dispatch for the
  same-session UI to show it immediately).

## currency.ts

- `formatCurrency(amount, currency: Currency = "EUR")` — `Intl.NumberFormat`
  `de-DE` locale, e.g. `1234.5` → `"1.234,50 €"`. Use for all money display;
  don't hand-roll formatting.
- `calculateNetProfit(revenue, expenses, purchases)` — `revenue - expenses - purchases`.
- `sumAmounts(amounts: number[])` — sums and rounds to 2 decimals (avoids FP
  drift from naive `reduce`).
- `calculateMargin(revenue, cost)` → `number | null` — percentage rounded to
  2 decimals; **returns `null` when `revenue === 0`** to avoid `Infinity`/`NaN`
  — callers must handle the null case (e.g. render "—").
- `vatAmountFromGross(gross, ratePercent)` — extracts the VAT portion from a
  VAT-inclusive total: `gross * rate / (100 + rate)`, rounded to 2 decimals.
  Used by the Add/Edit modals in Sales/Purchases/Expenses (and
  `generateInvoice.ts`'s totals block) wherever a record's `total_amount`/`amount`
  is gross and `vat_rate`/`vat_amount` need deriving — never *add* VAT on top,
  the stored total is already the gross/paid figure.

## date.ts

- `formatDate(isoDate)` — `"2024-06-01"` → `"01.06.2024"` (`de-DE` short date).
- `formatDateTime(isoDate)` — `de-DE` date + time, e.g. `"01.06.2024, 16:30 Uhr"`.
- `getMonthRange(year, month)` → `{ from, to }` ISO strings for the first/last
  day of the month. Builds dates from local-date components (`new Date(year, month, day)`)
  rather than parsing ISO strings, specifically to dodge UTC offset shifts —
  keep that pattern if you extend it.

## filters.ts

The date-preset + entity-filter logic backing `FilterBar` (see
`components/ui/SKILL.md`) on the Sales/Expenses/Purchases list pages.

- `DatePreset = "all" | "this_month" | "last_month" | "this_quarter" | "this_year" | "custom"`
- `getPresetRange(preset)` → `{ from, to } | null` — concrete ISO range for a
  preset; `null` for `"all"`/`"custom"` (custom is resolved by the caller).
- `resolveDateRange(preset, dateFrom, dateTo)` — the one to call generally;
  handles `"custom"` by falling back to sentinel bounds (`"0000-00-00"` /
  `"9999-99-99"`) when only one side is provided, and to `null` (no filter)
  when both are empty.
- Per-entity filter shapes + defaults: `SalesFilters`/`DEFAULT_SALES_FILTERS`,
  `ExpenseFilters`/`DEFAULT_EXPENSE_FILTERS`, `PurchaseFilters`/`DEFAULT_PURCHASE_FILTERS`.
  Note `PurchaseFilters.vendor` defaults to `""` (free-text search) while
  Sales/Expenses use a `"all"`-sentinel dropdown (`platform`/`category`) —
  don't conflate the two when adding a new entity filter.
- `filterSales`/`filterExpenses`/`filterPurchases` — apply a filter object to
  an array; each composes `resolveDateRange` + the entity-specific field
  checks. Add new filterable fields here, mirroring the existing per-field
  `if` blocks.
- `isRevenueSale(sale: { status: string | null })` — **canonical revenue-eligibility
  predicate**. Returns `true` when the sale counts toward revenue (i.e. status is
  neither `"returned"` nor `"cancelled"`; `null` counts as revenue-eligible).
  Used by `page.tsx` (overview) to derive `effectiveSales`. **Update this one
  function to change the rule everywhere** — never write inline `status !== "returned"`
  checks.
- `isDefaultFilters(f)` — drives the `FilterBar`'s "Clear" button visibility
  (`hasActive = !isDefaultFilters(filters)`); uses `"x" in f` narrowing so one
  function works across all three filter shapes.

## csv.ts

Export and import primitives for the CSV round-trip on Sales/Expenses/Purchases.

- `exportToCsv(filename, rows, columns)` — triggers a browser download. Values
  are quoted/escaped; `null`/`undefined` become empty cells.
- `detectDelimiter(headerLine) → "," | ";" | "\t"` — counts candidate
  characters **outside quoted sections** and takes the highest, comma on a tie.
  This exists because German Excel exports use `;` (comma is the decimal
  separator in the `de` locale) — do not assume comma anywhere in the pipeline.
- `parseCsvText(text) → { headers, rows }` — headers are lowercased and
  trimmed; `rows` is an array of `Record<string, string>`. This is the shape the
  whole import pipeline (`resolveHeaders` → `canonicalizeRow` →
  `validateRowForFormat`) consumes.

## excel.ts

`parseExcelBuffer(buffer) → { headers, rows }` — parses `.xlsx`/`.xls` from an
`ArrayBuffer` via SheetJS.

**Returns exactly the same shape as `parseCsvText`**, which is the entire point:
the Sales import modal feeds both file types through one unchanged pipeline.
Preserve that contract if you touch either module.

- First worksheet only.
- Headers lowercased + trimmed (matching `parseCsvText`).
- Entirely blank rows dropped.
- Dates are emitted as `YYYY-MM-DD` strings so `parseFlexibleDate` accepts them.

> `xlsx` is the dependency flagged in `AUDIT_2026-07-24.md` §2.3 (prototype
> pollution + ReDoS, no npm fix). It only ever parses a file the user picked
> themselves, but keep the blast radius in mind before reusing it server-side.

## localeParse.ts

Locale-tolerant parsing for CSV/Excel import — German **and** English inputs.
Pure, fully tested. Both functions return `null` on unparseable input; a `null`
on a required field is a **row error**, never a silent `0` or today's date.

- `parseLocaleNumber(input) → number | null` — disambiguation rules:
  - both `.` and `,` present → the **last** one is the decimal separator
  - only `,` → decimal comma (`"9,99"` → `9.99`)
  - only `.` → thousands separator *only* for the exact pattern
    `\d{1,3}(\.\d{3})+` (`"1.234"` → `1234`); otherwise decimal (`"9.99"` → `9.99`)
- `parseFlexibleDate(input, order?) → string | null` — accepts ISO
  (`"2024-01-15"`) or separated (`"15.01.2024"`, `"26-03-2026"`, `"26/03/2026"`)
  dates and returns ISO `YYYY-MM-DD`. `order` (`DateOrder = "dmy" | "mdy"`)
  defaults to `"dmy"`, so every pre-existing caller is unchanged; pass `"mdy"`
  to read `/`- or `-`-separated dates month-first. **Dot-separated dates are
  always day-first regardless of `order`** — `DD.MM.YYYY` is the German
  convention and `MM.DD.YYYY` does not occur. Validates real calendar dates;
  **two-digit years are rejected** rather than guessed at.
- `detectDateOrder(values: string[]) → DateOrderDetection` — decides day-first
  vs month-first for a whole file from evidence rather than assumption:
  `{ order: DateOrder; confident: boolean; conflict?: { dayFirstSample,
  monthFirstSample } }`. `order` always has a usable value (falls back to
  `"dmy"` when undecidable); `confident` is true only when the file contained
  a `/`- or `-`-separated date whose other reading isn't a valid month (e.g.
  `30-04-2026`, which can only be day-first); `conflict` is set only when the
  file has hard evidence for BOTH orders — callers must refuse the import in
  that case, never pick one arbitrarily. Dot-separated dates carry no evidence
  either way. Used by `ImportSalesModal` — see `sales/CLAUDE.md` →
  "Date-order detection".

## detectPlatform.ts

Source-URL/SKU helpers for Dropshipping and the eBay listing wizard.

- `detectPlatform(url) → SourcePlatform | null` — identifies the supplier from a
  product URL.
- `isAliExpressSku(sku) → sku is string` — type guard; true when the SKU looks
  like an AliExpress item ID (all digits, plausible length). The seller stores
  that ID as the eBay SKU / Custom Label, which is what makes the link possible.
- `aliExpressUrlFromSku(sku)` — rebuilds the product URL from that item ID
  (`de.aliexpress.com`).

## pagedQuery.ts

The shared contract for the server-side pagination architecture described in
`AGENTS.md` — every paginated feature uses these rather than its own maths.

- `DEFAULT_PAGE_SIZE = 50` — also the page size `dashboard/layout.tsx` hydrates.
- `PageRequest` — `{ page, pageSize }`; `page` is **1-indexed**.
- `rangeFor({ page, pageSize }) → [from, to]` — inclusive bounds for Supabase
  `.range(from, to)`. `page=1, pageSize=50` → `[0, 49]`.

## planGating.ts

Subscription-plan feature gates, keyed off `TenantPlan`. Pure lookups against
`PLAN_LIMITS`; no Supabase calls.

- `getPlanLimits(plan) → PlanLimits`
- `canAddUser(plan, currentUserCount) → boolean` — backs the Users feature's
  invite gate.
- `hasPlatformIntegrations(plan) → boolean` — gates `/dashboard/integrations`,
  `/dashboard/listings` and `/dashboard/messages` (Pro/Business only). Read the
  plan from `currentUserSlice.tenantPlan`, hydrated by `dashboard/layout.tsx`.
- `hasAiFeatures(plan) → boolean`

**These are UI gates, not security boundaries.** `plan` itself is owned by the
Stripe webhook (`AGENTS.md` key rule 4) — never write it from UI. This is the
one module here with **no colocated test**; add `planGating.test.ts` if you
extend it.

## validation.ts

Pure field validators for the settings forms. Every function returns `null` when
valid **or blank** (all fields are optional) and a human-readable string when
present-but-malformed — so a falsy return means "fine to submit".

- `validateIBAN(value)` — strips spaces; two uppercase letters, two digits, then
  11–30 alphanumerics.
- `validateVATId(value)` — strips spaces; two uppercase letters + 2–13
  alphanumerics. Deliberately permissive across countries.
- `validateEmail(value)` — standard format check.
- `validateVATRate(value: number | string)` — coerces, then requires 0–100
  inclusive.

## permissions.ts

Static role-based permission matrix — no Supabase calls, pure lookups against
`UserRole` from `src/types`.

- `PERMISSIONS` — `Record<Permission, readonly UserRole[]>`. `Permission` is
  derived as `keyof typeof PERMISSIONS`, so adding a key automatically extends
  the type. Naming convention: `<verb>_<entity>` (`create_expense`,
  `manage_users`, `view_audit_logs`, ...). `manage_integrations` (`["admin",
  "super_admin"]`) gates connecting/disconnecting/syncing platforms on
  `/dashboard/integrations` — accountants see the page (if the tenant's plan
  has it) but get a "contact your admin" message instead of the connection
  cards.
- `ALL_PERMISSIONS` — `Object.keys(PERMISSIONS) as Permission[]`, for
  enumerating every permission (used by the Users feature's Permissions modal
  to render a full checklist).
- `PERMISSION_LABELS` — `Record<Permission, string>` human-readable label per
  permission, also consumed by the Permissions modal.
- `hasPermission(role, permission, overrides?)` — the primitive check; most
  call sites should use this directly (e.g. to show/hide an Edit/Delete
  button). Third param `overrides` (a `Profile.permission_overrides` array,
  optional, defaults to `[]`) is **additive only** — it can grant a
  permission the role lacks, never take one away. Pass
  `profile?.permission_overrides` whenever you have the full profile
  available (Redux `state.currentUser.profile` client-side, or a
  `role, permission_overrides` Supabase select server-side); omit it only
  where role-only is intentional/fine.
- `canAccessRoute(role, pathname, overrides?)` — route-level gate used by
  `src/proxy.ts` (this app's middleware-equivalent) to block `/dashboard/users`
  and `/dashboard/audit-logs` for roles (and overrides) without
  `manage_users`/`view_audit_logs`. Everything else returns `true` (any
  authenticated role).
- `ROLE_HIERARCHY = ["accountant", "admin", "super_admin"]` (ascending) backs
  `hasMinimumRole(role, minimum)` — an index comparison, for "at least as
  privileged as X" checks rather than an exact-permission lookup. Not
  override-aware (overrides only ever apply to a specific `Permission` key,
  never to the role hierarchy itself).
- Adding a new role to `UserRole` means updating `ROLE_HIERARCHY` *and* every
  relevant `PERMISSIONS` array — neither is enforced by the type system.
- **Per-user permission overrides** (`Profile.permission_overrides: string[]`,
  a jsonb array column, see `supabase/migrations/023_user_permission_overrides.sql`):
  managed via the Users feature's Permissions modal
  (`src/app/dashboard/users/_components/PermissionsModal.tsx`), super_admin
  only. `delete_sale`/`delete_expense`/`delete_purchase` overrides are ALSO
  enforced in Postgres RLS (`{{schema}}.current_user_has_override(perm)`,
  since those three DELETE policies are role-only, not app-code-gated) — see
  that migration's header comment. Every other permission in the matrix is
  only ever checked in application code (proxy.ts/authGuard.ts/page-level
  `hasPermission` calls), so granting e.g. `manage_integrations` via an
  override needs no RLS change — the app code is already the sole gate.

## invoiceMath.ts

Pure computation helpers for invoice totals — no Supabase, no Redux, fully
testable. Covered by `invoiceMath.test.ts`.

- `computeOrderInvoiceTotals(sale: Sale) → OrderInvoiceTotals` — single-sale
  breakdown: `itemsGross`, `shipping`, `vatItems`, `vatShipping`, `vatTotal`,
  `net` (excl. VAT), `grandTotal` (= itemsGross + shipping, VAT-inclusive
  Amazon-style). Used by `generateOrderInvoice` only.
- `computeBulkTotals(sales: Sale[]) → BulkTotals` — sums `total_amount`
  (→ `subtotal`), `shipping_charged ?? 0` (→ `shipping`), `vat_amount ?? 0`
  (→ `vat`) across a Sale array. `grandTotal = subtotal + shipping`. All
  fields rounded to 2 decimals. **Currency-agnostic** — caller must group by
  currency before calling if per-currency breakdowns are needed. Used by
  `generateSalesInvoice` and `InvoiceModal`.
- `invoiceNumberFor(sale, prefix)` — deterministic, id-based invoice number
  (`${prefix}${YYYYMM}-${sale.id.slice(0,8)}`). Used by `generateOrderInvoice`
  only; bulk invoices use the random `generateInvoiceNumber` inside
  `generateInvoice.ts`.

## tenantSlug.ts

Tenant slug generation and sanitization — pure functions, fully tested. Used by
admin provisioning (explicit slug input) and self-serve signup (company name +
email fallback) to ensure both paths produce byte-identical schema names.

- `sanitizeSlug(input: string) → string` — the exact sanitization the admin
  provisioning route has always applied. Lowercases, strips anything outside
  `[a-z0-9-]`, converts hyphens to underscores, truncates to 40 characters.
  **Order matters**: characters are stripped BEFORE hyphen conversion, so spaces
  vanish rather than becoming separators (`"Acme GmbH"` → `"acmegmbh"`). May
  return an empty string when the input has no ASCII alphanumerics.
- `slugForCompany(companyName: string, email: string) → string` — guaranteed
  non-empty slug for self-serve signup. Tries the company name, falls back to
  email local part, then to the constant `"tenant"`. **Critical gotcha**: a
  company name with no ASCII alphanumerics sanitizes to empty, which would build
  the schema name `tenant_` — and that passes `provision_tenant_schema`'s
  `LIKE 'tenant_%'` guard, silently creating a real, wrongly-named schema that
  every subsequent unusable-name signup would collide with. This function exists
  to prevent that. Admin provisioning deliberately does NOT use this function
  (calls `sanitizeSlug` directly instead) — an admin supplies the slug
  explicitly, and a silent fallback would hide their typo.
- `schemaNameFor(slug: string) → string` — prefixes the slug with `"tenant_"`.
- `nextAvailableSlug(base: string, taken: readonly string[]) → string` — finds
  the first free slug in the `base`, `base_2`, `base_3` … sequence, checked
  against a `taken` list. Bounded to 100 attempts to prevent infinite loops on
  pathological inputs; throws an `Error` if exhausted.

### Gotchas

- **Empty slug danger** — `sanitizeSlug("株式会社")` → `""`, which would build
  `tenant_` and pass the Postgres guard. Always use `slugForCompany` for
  user-supplied company names in self-serve flows, never `sanitizeSlug` alone.
- **Admin vs. self-serve** — admin provisioning uses `sanitizeSlug +
  schemaNameFor` only (explicit slug, no fallback). Self-serve uses
  `slugForCompany` (company name with fallback chain). Do not mix them.

## generateInvoice.ts

Client-side PDF generation via `jspdf`/`jspdf-autotable`, **dynamically
imported** (`getJsPDF`/`getAutoTable`) to avoid pulling them into the SSR
bundle — keep that pattern if you touch the imports.

- `generateSalesInvoice(sales, settings)` — builds a Sales Invoice PDF. Table
  columns: #, Date, Product, Platform, Qty, Unit Price, Total, **Shipping**,
  VAT. Per-currency totals block always prints all four lines even when zero:
  Subtotal / Shipping / VAT / Grand Total (computed via `computeBulkTotals`).
- `generateExpensesInvoice(expenses, settings)` — Expense Report PDF. VAT line
  now **always printed** per currency (was skipped when `vat_amount` was falsy).
- `generatePurchasesInvoice(purchases, settings)` — Purchase Report PDF. Same
  always-print VAT fix as expenses.
- `generateOrderInvoice(sale, settings)` — per-order single-sale PDF. Uses
  `invoiceNumberFor` (deterministic) + `computeOrderInvoiceTotals`. Logo is
  fetched async before calling `addHeader`, then passed as `logoDataUrl`.
  Filename: `${invoiceNumberFor(sale, prefix)}.pdf`. Used by `[id]/page.tsx`.
- `addHeader(doc, settings, invoiceNumber, title, logoDataUrl?)` — **sync**.
  Accepts an optional pre-resolved `logoDataUrl` string; renders the logo
  top-right (40×20mm) when provided. Callers that need a logo must fetch +
  base64-encode it *before* calling `addHeader` and pass the result in.
  `generateOrderInvoice` does this; `generateSalesInvoice` etc. currently do
  not (logo optional for bulk reports).
- `generateInvoiceNumber(prefix)` — `${prefix}${YYYYMM}-${4-digit random}`.
  Not guaranteed unique; display/filing convenience, not a DB key.
- `doc`/`autoTable` callback params are typed `any` (with eslint-disable
  comments) — `jsPDF`'s plugin types don't expose `lastAutoTable`; keep the
  disables if you add similar `(doc as any)` accesses.

### Gotchas

- **Logo in `addHeader` is sync** — pass a pre-resolved base64 dataUrl, never
  a URL string. The fetch must happen before calling `addHeader`. See
  `generateOrderInvoice` for the fetch → FileReader → dataUrl pattern.
- **`computeBulkTotals` is currency-agnostic** — it sums all Sales in the
  array regardless of currency. Group by `sale.currency` first if you need
  per-currency breakdowns (see `generateSalesInvoice` for the grouping
  pattern).
- **Grand Total = subtotal + shipping** (VAT is included in subtotal,
  Amazon-style). Never add VAT on top — stored `total_amount` is already
  the gross/paid figure.

## Where these are used

`audit.ts`/`currency.ts`/`date.ts`/`permissions.ts` are imported directly by
feature `page.tsx`/`_components/*` files and `_store/*Slice.ts` reducers.
`filters.ts` pairs specifically with `components/ui/FilterBar.tsx`.
`generateInvoice.ts` is invoked from `components/modals/InvoiceModal.tsx` and
`app/dashboard/settings/page.tsx` (preview/test-generate button).
`csv.ts`/`excel.ts`/`localeParse.ts` are the import/export stack behind the
`Import*Modal`/`export` buttons on Sales, Expenses and Purchases.
`pagedQuery.ts` is used by every `fetch*Page` thunk plus
`dashboard/layout.tsx`'s hydration query. `planGating.ts` is read by the
Integrations, Listings and Messages pages and by the Users invite flow.
`validation.ts` backs the Settings company-profile form.
`detectPlatform.ts` is used by Dropshipping and the listing wizard's Source step.

## Testing

Every module here has a colocated `*.test.ts` **except `generateInvoice.ts`**
(jsPDF is awkward to assert on — its pure maths lives in `invoiceMath.ts`, which
*is* tested) and **`planGating.ts`** (no test yet — add one if you extend it).

```bash
npx jest lib/utils
```
