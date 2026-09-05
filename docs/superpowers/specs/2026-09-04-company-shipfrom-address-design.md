# Structured sender (ship-from) address on Company Profile

**Date:** 2026-09-04
**Status:** Design approved by user. Ready for an implementation plan.
**Piece:** 3 of 4 in the "eBay order fulfillment" decomposition. Independent
of Piece 1 (status sync) and Piece 2 (buyer address). Piece 4 (label
generation) depends on this piece being implemented first.

## Problem

`company_profile.address` is a single free-text field, fine for printing on
an invoice PDF but useless as a shipping carrier's "from" address — a label
API needs discrete street/city/state/postal/country fields, not a blob of
text a human formatted by hand.

## Scope

**In scope:** a second, structured address — street lines, city, state,
postal code, country — on `company_profile`, used only as the sender address
for shipping labels (Piece 4). The existing free-text `address` field is
**untouched** and keeps doing exactly what it does today (invoice header).

**Explicitly out of scope:** migrating/parsing the existing free-text
`address` into the new structured fields (no reliable way to do that
automatically; a tenant re-enters it once in the new section — a one-time,
low-friction cost, and the two fields serve genuinely different purposes so
keeping them separate isn't duplication, it's separation of concerns).
Changing `generateInvoice.ts`/`InvoiceModal.tsx` — invoices keep reading
`address` exactly as before. A separate "sender name" or "sender phone"
field — `company_profile.name`/`company_profile.phone` (both already exist)
are reused for these at label-generation time in Piece 4, so this piece adds
only the fields that don't already exist anywhere on `CompanyProfile`.

## Data model

New nullable columns on `company_profile`, migration
`supabase/migrations/042_company_profile_shipfrom_address.sql`
(`run_on_all_tenant_schemas` — `company_profile` is a per-tenant table, not
control-plane):

```sql
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

Also add the same six columns to `provision_tenant_schema()`'s
`company_profile` CREATE TABLE in `005_tenant_provisioning.sql` (the "2
places" rule — check that file's current `company_profile` table definition
before editing, since it's built from an evolving set of prior migrations).

`src/types/index.ts`'s `CompanyProfile` interface gets, placed right after
the existing `address` field (same nullable-address-ish grouping):

```ts
ship_from_street1: string | null;
ship_from_street2: string | null;
ship_from_city: string | null;
ship_from_state: string | null;
ship_from_postal_code: string | null;
/** ISO 3166-1 alpha-2, e.g. "DE". Free text — validated at label-purchase time (Piece 4), not here. */
ship_from_country: string | null;
```

## Capture — Settings page

`src/app/dashboard/settings/page.tsx`: new section **"Shipping From
Address"**, inserted between the existing "Contact" and "Tax & Registration"
sections (same card shell: `rounded-[var(--radius-card)] border
border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4` + an
`<h2>`), with a one-line explainer paragraph matching the "Company Profile"
section's `<p className="text-xs text-[var(--color-text-muted)]">` style:

> "Used as the sender address when generating shipping labels. Your company
> name and phone number above are reused automatically."

Fields, following the existing `Row`-pairing convention:

- Street Address (Line 1) — full width `Field`+`Input`
- Street Address (Line 2, optional) — full width `Field`+`Input`
- `Row`: City / State or Region
- `Row`: Postal Code / Country

All follow the existing pattern exactly: `value={companyForm.ship_from_x ??
""}`, `onChange={(e) => setCompany("ship_from_x", e.target.value || null)}`,
`disabled={!canEditCompanyProfile}`. None are `required` — a tenant that
never uses shipping labels can leave this section blank forever; Piece 4's
"Generate Label" button is simply hidden/disabled when these fields are
incomplete (that piece's concern, not this one's).

`handleCompanyProfileSubmit`'s `.upsert(...)` payload gets the six new keys
alongside the existing ones.

## Blast radius

Purely additive: six nullable columns, one new Settings section, six new
keys in one existing upsert payload. No change to `generateInvoice.ts`,
`InvoiceModal.tsx`, `DEMO_SALE`, or any existing Settings section. A tenant
that never fills in the new section has all six fields `null` and Piece 4
(when implemented) treats that as "sender address not configured yet".

## Testing

Per `AGENTS.md`, this folder's existing convention (`settings/CLAUDE.md`:
"No tests target `page.tsx`") continues — no dev server, no new test file
expected for the form itself. If `companyProfileSlice.test.ts` is touched
for any reason, confirm `hydrateCompanyProfile` still round-trips the six
new fields (it should, unmodified — the reducer just assigns the whole
payload).

Manual verification (ask the user to exercise in browser, per working
agreement):
- As `admin`/`super_admin`, fill in the Shipping From Address section, Save
  → reload the page → confirm all six values persist.
- As `accountant`, confirm the new section renders read-only (matches every
  other Company Profile field's `canEditCompanyProfile` gate) with no Save
  button.
- Leave the section blank, Save → confirm no error (all six stay `null`).

## Docs to update alongside implementation

- `src/app/dashboard/settings/CLAUDE.md` — add "Shipping From Address:
  `ship_from_street1/2`, `ship_from_city`, `ship_from_state`,
  `ship_from_postal_code`, `ship_from_country`" to the section list, noting
  it reuses `name`/`phone` and is consumed by the (separate) shipping-label
  feature.
- `supabase/SKILL.md` / `supabase/CLAUDE.md` — apply-status row + file-list
  bullet for migration `042`.
