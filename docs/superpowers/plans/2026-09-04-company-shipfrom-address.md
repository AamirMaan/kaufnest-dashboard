# Company ship-from address Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, structured sender address (street lines, city, state,
postal code, country) to `company_profile`, captured in a new "Shipping From
Address" section on the Settings page, for use as the ship-from address by a
later shipping-label feature. The existing free-text `address` field is
untouched.

**Architecture:** Six new nullable `text` columns on the per-tenant
`company_profile` table, added via `run_on_all_tenant_schemas` (migration
`042`) and mirrored into `provision_tenant_schema()` for future tenants (the
repo's "2 places" rule). The `CompanyProfile` TypeScript type gains the same
six fields. `src/app/dashboard/settings/page.tsx` gets one new form section,
following the exact `Field`/`Row`/section styling already used by the
Contact/Tax & Registration sections on that page, and the six keys are added
to the existing `company_profile` upsert payload. No new component, no new
Redux logic — `companyProfileSlice`'s `hydrateCompanyProfile` reducer already
assigns the whole payload object, so it needs no change.

**Tech Stack:** Next.js App Router (Client Component), Supabase Postgres
(tenant-schema DDL via `run_on_all_tenant_schemas`), Redux Toolkit
(`companyProfileSlice`, unchanged), existing `components/ui/FormFields`
primitives (`Field`, `Input`, `Row`).

## Global Constraints

Copied verbatim from this repo's `AGENTS.md` — every task below must honor
these:

1. Never query `public.*` — all tenant data lives in `tenant_<slug>` schemas.
2. Never hardcode a schema name — read it from `user.app_metadata.tenant_schema`.
3. Control plane client (`createControlClient`) is server-only — never in Client Components.
4. Stripe webhooks are the source of truth for `plan`/`status` — never write those directly from UI.
5. **Tenant schema DDL must use `run_on_all_tenant_schemas`** — never write
   `ALTER TABLE tenant_kaufnest.*` directly in a new migration. Use:
   ```sql
   SELECT public.run_on_all_tenant_schemas($$
     ALTER TABLE {{schema}}.sales ADD COLUMN IF NOT EXISTS …;
   $$);
   ```
   Also update `provision_tenant_schema()` in `005_tenant_provisioning.sql`
   for new tenants — the "2 places" rule.
6. **Working agreement (this repo's `AGENTS.md`):** don't start the dev
   server yourself or `curl` routes to verify functionality; don't run
   `npm test`, `npx tsc --noEmit`, or `npm run lint` mid-task to check your
   work — ask the human to run the relevant command and paste output back.
   The only exception is what Husky's `.husky/pre-commit`/`.husky/pre-push`
   hooks run automatically when you `git commit`/`git push` — that's fine,
   it isn't you running the command.
7. None of the six new fields are `required` — a tenant that never uses
   shipping labels can leave the whole section blank forever.

---

### Task 1: Migration, `CompanyProfile` type, `provision_tenant_schema()`, and Supabase docs

**Files:**
- Create: `supabase/migrations/042_company_profile_shipfrom_address.sql`
- Modify: `src/types/index.ts:218-237` (the `CompanyProfile` interface)
- Modify: `supabase/migrations/005_tenant_provisioning.sql:241-262` (the
  `company_profile` `CREATE TABLE` inside `provision_tenant_schema()`)
- Modify: `supabase/SKILL.md` (file map + apply-status table)
- Modify: `supabase/CLAUDE.md` (file list)

**Interfaces:**
- Produces: `CompanyProfile.ship_from_street1: string | null`,
  `ship_from_street2: string | null`, `ship_from_city: string | null`,
  `ship_from_state: string | null`, `ship_from_postal_code: string | null`,
  `ship_from_country: string | null` — Task 2 reads and writes these exact
  field names on `companyForm` (a `CompanyProfile`) and includes them in the
  `company_profile` upsert payload.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/042_company_profile_shipfrom_address.sql` with
this exact content:

```sql
-- ============================================================
-- 042 — structured sender (ship-from) address on company_profile
--
-- Six new nullable columns, used only as the sender address for shipping
-- labels (a later feature). The existing free-text `address` column is
-- untouched and keeps doing exactly what it does today (invoice header) —
-- these are deliberately separate fields, not a migration/parse of the old
-- one, since there is no reliable way to parse a free-text address into
-- discrete street/city/state/postal/country fields automatically.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.company_profile
    ADD COLUMN IF NOT EXISTS ship_from_street1 text,
    ADD COLUMN IF NOT EXISTS ship_from_street2 text,
    ADD COLUMN IF NOT EXISTS ship_from_city text,
    ADD COLUMN IF NOT EXISTS ship_from_state text,
    ADD COLUMN IF NOT EXISTS ship_from_postal_code text,
    ADD COLUMN IF NOT EXISTS ship_from_country text;
$$);
```

- [ ] **Step 2: Add the six fields to the `CompanyProfile` type**

In `src/types/index.ts`, the `CompanyProfile` interface currently reads
(lines 218-237):

```ts
export interface CompanyProfile {
  id: string;
  name: string;
  logo_url: string | null;
  vat_number: string | null;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  currency: Currency;
  timezone: string;
  vat_rate: number;
  bank_name: string | null;
  iban: string | null;
  bic: string | null;
  invoice_prefix: string;
  payment_terms: string;
  footer_notes: string | null;
  updated_at: string;
}
```

Change the `address` / `phone` lines to insert the six new fields between
them:

```ts
export interface CompanyProfile {
  id: string;
  name: string;
  logo_url: string | null;
  vat_number: string | null;
  tax_id: string | null;
  address: string | null;
  ship_from_street1: string | null;
  ship_from_street2: string | null;
  ship_from_city: string | null;
  ship_from_state: string | null;
  ship_from_postal_code: string | null;
  /** ISO 3166-1 alpha-2, e.g. "DE". Free text — validated at label-purchase time (a later shipping-label feature), not here. */
  ship_from_country: string | null;
  phone: string | null;
  email: string | null;
  currency: Currency;
  timezone: string;
  vat_rate: number;
  bank_name: string | null;
  iban: string | null;
  bic: string | null;
  invoice_prefix: string;
  payment_terms: string;
  footer_notes: string | null;
  updated_at: string;
}
```

- [ ] **Step 3: Mirror the six columns into `provision_tenant_schema()`**

In `supabase/migrations/005_tenant_provisioning.sql`, the `company_profile`
`CREATE TABLE` block currently reads (lines 241-262):

```sql
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.company_profile (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name           text NOT NULL,
      logo_url       text,
      vat_number     text,
      tax_id         text,
      address        text,
      phone          text,
      email          text,
      currency       text NOT NULL DEFAULT 'EUR',
      timezone       text NOT NULL DEFAULT 'UTC',
      vat_rate       numeric NOT NULL DEFAULT 19,
      bank_name      text,
      iban           text,
      bic            text,
      invoice_prefix text NOT NULL DEFAULT 'INV-',
      payment_terms  text NOT NULL DEFAULT '30 days',
      footer_notes   text,
      updated_at     timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);
```

Replace it with (adds the six `ship_from_*` columns between `address` and
`phone`, matching Task 1 Step 2's type ordering):

```sql
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.company_profile (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name           text NOT NULL,
      logo_url       text,
      vat_number     text,
      tax_id         text,
      address        text,
      ship_from_street1     text,
      ship_from_street2     text,
      ship_from_city        text,
      ship_from_state       text,
      ship_from_postal_code text,
      ship_from_country     text,
      phone          text,
      email          text,
      currency       text NOT NULL DEFAULT 'EUR',
      timezone       text NOT NULL DEFAULT 'UTC',
      vat_rate       numeric NOT NULL DEFAULT 19,
      bank_name      text,
      iban           text,
      bic            text,
      invoice_prefix text NOT NULL DEFAULT 'INV-',
      payment_terms  text NOT NULL DEFAULT '30 days',
      footer_notes   text,
      updated_at     timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);
```

- [ ] **Step 4: Update `supabase/SKILL.md`'s file map**

In `supabase/SKILL.md`, find the table row for
`migrations/039_ebay_listing_drafts_inactive_status.sql` (it is the last
`migrations/NNN` row before the `control-plane/001_schema.sql` row). Add a
new row immediately after it:

```
| `migrations/042_company_profile_shipfrom_address.sql` | all `tenant_%` schemas | ⏳ **pending** — adds six nullable `ship_from_street1`/`ship_from_street2`/`ship_from_city`/`ship_from_state`/`ship_from_postal_code`/`ship_from_country` text columns to `company_profile` via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. A structured sender address for a later shipping-label feature — the existing free-text `address` column is untouched and keeps backing the invoice header. See `docs/superpowers/specs/2026-09-04-company-shipfrom-address-design.md`. Backs `src/app/dashboard/settings/`. |
```

- [ ] **Step 5: Update `supabase/CLAUDE.md`'s file list**

In `supabase/CLAUDE.md`, find the bullet for
`migrations/039_ebay_listing_drafts_inactive_status.sql` (it is the last
`migrations/NNN` bullet before the `## Related code` heading). Add a new
bullet immediately after it:

```
- `migrations/042_company_profile_shipfrom_address.sql` — adds six nullable
  `ship_from_street1`, `ship_from_street2`, `ship_from_city`,
  `ship_from_state`, `ship_from_postal_code`, `ship_from_country` text
  columns to `company_profile` in every tenant schema via
  `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()`
  in the same commit. A structured sender address, captured on the Settings
  page's new "Shipping From Address" section and used only by a later
  shipping-label feature — the existing free-text `address` column is
  untouched and keeps backing the invoice header PDF. See
  `docs/superpowers/specs/2026-09-04-company-shipfrom-address-design.md`.
  Backs the Settings feature (`src/app/dashboard/settings/`).
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/042_company_profile_shipfrom_address.sql \
  src/types/index.ts \
  supabase/migrations/005_tenant_provisioning.sql \
  supabase/SKILL.md \
  supabase/CLAUDE.md
git commit -m "feat(company-profile): add ship-from address columns + provisioning + type

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

This will trigger the `.husky/pre-commit` hook (`tsc --noEmit`, `eslint`,
project verifier). If it fails, fix the reported errors, re-stage, and
commit again — do not use `--no-verify`.

---

### Task 2: Settings page "Shipping From Address" section + docs

**Files:**
- Modify: `src/app/dashboard/settings/page.tsx:76-94` (the
  `handleCompanyProfileSubmit` upsert payload)
- Modify: `src/app/dashboard/settings/page.tsx:199-231` (insert a new
  section between the existing Contact section and the Tax & Registration
  section)
- Modify: `src/app/dashboard/settings/CLAUDE.md` (file map)

**Interfaces:**
- Consumes: `CompanyProfile.ship_from_street1/street2/city/state/postal_code/country`
  (all `string | null`, from Task 1 Step 2), the page's existing
  `setCompany<K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K])`
  helper (`page.tsx:64-66`, unchanged), and the existing `Field`/`Input`/`Row`
  components from `@/components/ui/FormFields` (already imported at the top
  of `page.tsx`, no new import needed).
- Produces: nothing consumed by a later task — this is the last task in the
  plan.

- [ ] **Step 1: Add the six keys to the upsert payload**

In `src/app/dashboard/settings/page.tsx`, `handleCompanyProfileSubmit`
currently upserts (lines 76-94):

```tsx
    const { data, error: dbError } = await supabase
      .from("company_profile")
      .upsert({
        id: companyForm.id,
        name: companyForm.name,
        logo_url: companyForm.logo_url,
        vat_number: companyForm.vat_number,
        tax_id: companyForm.tax_id,
        address: companyForm.address,
        phone: companyForm.phone,
        email: companyForm.email,
        currency: companyForm.currency,
        timezone: companyForm.timezone,
        vat_rate: companyForm.vat_rate,
        bank_name: companyForm.bank_name,
        iban: companyForm.iban,
        bic: companyForm.bic,
        invoice_prefix: companyForm.invoice_prefix,
        payment_terms: companyForm.payment_terms,
        footer_notes: companyForm.footer_notes,
      })
      .select()
      .single<CompanyProfile>();
```

Replace it with (adds the six `ship_from_*` keys between `address` and
`phone`):

```tsx
    const { data, error: dbError } = await supabase
      .from("company_profile")
      .upsert({
        id: companyForm.id,
        name: companyForm.name,
        logo_url: companyForm.logo_url,
        vat_number: companyForm.vat_number,
        tax_id: companyForm.tax_id,
        address: companyForm.address,
        ship_from_street1: companyForm.ship_from_street1,
        ship_from_street2: companyForm.ship_from_street2,
        ship_from_city: companyForm.ship_from_city,
        ship_from_state: companyForm.ship_from_state,
        ship_from_postal_code: companyForm.ship_from_postal_code,
        ship_from_country: companyForm.ship_from_country,
        phone: companyForm.phone,
        email: companyForm.email,
        currency: companyForm.currency,
        timezone: companyForm.timezone,
        vat_rate: companyForm.vat_rate,
        bank_name: companyForm.bank_name,
        iban: companyForm.iban,
        bic: companyForm.bic,
        invoice_prefix: companyForm.invoice_prefix,
        payment_terms: companyForm.payment_terms,
        footer_notes: companyForm.footer_notes,
      })
      .select()
      .single<CompanyProfile>();
```

- [ ] **Step 2: Insert the new "Shipping From Address" section**

In `src/app/dashboard/settings/page.tsx`, the Contact section currently ends
and the Tax & Registration section begins like this (lines 199-233):

```tsx
          {/* Contact */}
          <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">
              Contact
            </h2>

            <Row>
              <Field label="Phone">
                <Input
                  type="tel"
                  value={companyForm.phone ?? ""}
                  onChange={(e) => setCompany("phone", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
                  placeholder="+49 30 123456"
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={companyForm.email ?? ""}
                  onChange={(e) => setCompany("email", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
                  placeholder="info@company.com"
                />
                {validateEmail(companyForm.email ?? "") && (
                  <p className="mt-1 text-xs text-(--color-warning,#f59e0b)">
                    {validateEmail(companyForm.email ?? "")}
                  </p>
                )}
              </Field>
            </Row>
          </section>

          {/* Tax & Registration */}
```

Insert a new section between the Contact section's closing `</section>` and
the `{/* Tax & Registration */}` comment, so the result reads:

```tsx
          {/* Contact */}
          <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">
              Contact
            </h2>

            <Row>
              <Field label="Phone">
                <Input
                  type="tel"
                  value={companyForm.phone ?? ""}
                  onChange={(e) => setCompany("phone", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
                  placeholder="+49 30 123456"
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={companyForm.email ?? ""}
                  onChange={(e) => setCompany("email", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
                  placeholder="info@company.com"
                />
                {validateEmail(companyForm.email ?? "") && (
                  <p className="mt-1 text-xs text-(--color-warning,#f59e0b)">
                    {validateEmail(companyForm.email ?? "")}
                  </p>
                )}
              </Field>
            </Row>
          </section>

          {/* Shipping From Address */}
          <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">
              Shipping From Address
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              Used as the sender address when generating shipping labels. Your
              company name and phone number above are reused automatically.
            </p>

            <Field label="Street Address (Line 1)">
              <Input
                value={companyForm.ship_from_street1 ?? ""}
                onChange={(e) => setCompany("ship_from_street1", e.target.value || null)}
                disabled={!canEditCompanyProfile}
                placeholder="123 Main St"
              />
            </Field>

            <Field label="Street Address (Line 2)">
              <Input
                value={companyForm.ship_from_street2 ?? ""}
                onChange={(e) => setCompany("ship_from_street2", e.target.value || null)}
                disabled={!canEditCompanyProfile}
                placeholder="Apt, suite, unit, etc. (optional)"
              />
            </Field>

            <Row>
              <Field label="City">
                <Input
                  value={companyForm.ship_from_city ?? ""}
                  onChange={(e) => setCompany("ship_from_city", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
                  placeholder="Berlin"
                />
              </Field>
              <Field label="State or Region">
                <Input
                  value={companyForm.ship_from_state ?? ""}
                  onChange={(e) => setCompany("ship_from_state", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
                  placeholder="Berlin"
                />
              </Field>
            </Row>

            <Row>
              <Field label="Postal Code">
                <Input
                  value={companyForm.ship_from_postal_code ?? ""}
                  onChange={(e) => setCompany("ship_from_postal_code", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
                  placeholder="10115"
                />
              </Field>
              <Field label="Country">
                <Input
                  value={companyForm.ship_from_country ?? ""}
                  onChange={(e) => setCompany("ship_from_country", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
                  placeholder="DE"
                />
              </Field>
            </Row>
          </section>

          {/* Tax & Registration */}
```

Note: none of these six fields carry the `required` prop on `Field` or the
`required` attribute on `Input` — per this plan's Global Constraints, the
section must stay fully optional. Do not add validation here; there is no
`validateX` helper for these fields (unlike `email`/`vat_number`/`iban`/
`vat_rate`) — the design spec explicitly defers format validation to the
later shipping-label feature.

- [ ] **Step 3: Update `src/app/dashboard/settings/CLAUDE.md`**

In `src/app/dashboard/settings/CLAUDE.md`, the section list currently reads
(lines 13-19):

```
  grouped into sections:
  - **Company Profile**: `name`, `logo_url`, `address`, `currency`, `timezone`
  - **Contact**: `phone`, `email`
  - **Tax & Registration**: `vat_number`, `tax_id`, `vat_rate` (default VAT
    rate used by the Add/Edit modals in Sales/Expenses/Purchases)
  - **Banking Details**: `bank_name`, `iban`, `bic`
  - **Invoice Defaults**: `invoice_prefix`, `payment_terms`, `footer_notes`
```

Replace it with (adds the new section between Contact and Tax &
Registration, matching their on-page order):

```
  grouped into sections:
  - **Company Profile**: `name`, `logo_url`, `address`, `currency`, `timezone`
  - **Contact**: `phone`, `email`
  - **Shipping From Address** (2026-09-04): `ship_from_street1`,
    `ship_from_street2`, `ship_from_city`, `ship_from_state`,
    `ship_from_postal_code`, `ship_from_country` — a structured sender
    address, separate from the free-text `address` field above (which keeps
    backing the invoice header PDF, untouched). Not consumed by anything in
    this codebase yet; it exists for a later shipping-label feature, which
    reuses `name`/`phone` from the Company Profile/Contact sections above
    for the sender name/phone rather than duplicating them here. All six
    fields are optional (no `required` prop) — a tenant that never uses
    shipping labels can leave the section blank forever.
  - **Tax & Registration**: `vat_number`, `tax_id`, `vat_rate` (default VAT
    rate used by the Add/Edit modals in Sales/Expenses/Purchases)
  - **Banking Details**: `bank_name`, `iban`, `bic`
  - **Invoice Defaults**: `invoice_prefix`, `payment_terms`, `footer_notes`
```

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/settings/page.tsx \
  src/app/dashboard/settings/CLAUDE.md
git commit -m "feat(settings): add Shipping From Address section to Company Profile

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

This will trigger the `.husky/pre-commit` hook (`tsc --noEmit`, `eslint`,
project verifier). If it fails, fix the reported errors, re-stage, and
commit again — do not use `--no-verify`.

---

## Manual verification (ask the human to do this — do not start a dev server or `curl` yourself)

Ask the user to run these in the browser once both tasks are committed
(matches the design spec's Testing section):

1. As `admin`/`super_admin`, open `/dashboard/settings`, fill in all six
   fields under "Shipping From Address", click Save Settings, reload the
   page → confirm all six values persisted.
2. As `accountant`, open `/dashboard/settings` → confirm the new section
   renders with all six fields disabled (matches every other Company
   Profile field's `canEditCompanyProfile` gate) and there is no Save
   button.
3. Leave the section blank, Save → confirm no error and the other sections
   still save correctly (all six `ship_from_*` fields stay `null`).

No new automated test is expected — `settings/CLAUDE.md` already documents
"No tests target `page.tsx`" and this change adds no new pure logic
function; `companyProfileSlice.test.ts` needs no change since
`hydrateCompanyProfile` assigns the whole payload object unconditionally.

## Note on migration apply-status

This plan creates migration `042` and updates `provision_tenant_schema()` in
the repo, matching the design spec. Per `supabase/SKILL.md`'s "apply-status
is unverified against the live databases" caveat, **actually running**
`042_company_profile_shipfrom_address.sql` (and re-applying
`005_tenant_provisioning.sql`) against the live Supabase projects is a
separate, manual step for the human — this plan's tasks only produce the
migration file and update the repo's tracked docs to mark it `⏳ pending`,
matching how every other recent migration in this repo is landed.
