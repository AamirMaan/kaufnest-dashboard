# Shipping label gating + order-detail layout fix

Date: 2026-09-07

## Problem

PR #92 shipped EasyPost-backed shipping label generation with no plan or
tenant gate — every tenant on every plan can purchase real labels today
(`src/lib/shipping/SKILL.md`'s Gotchas section flags this explicitly as
accepted-for-now, not an oversight). Two things need to change:

1. Turn EasyPost off by default, gated per-tenant (same shape as the
   existing AI feature toggle), so it can be enabled for specific tenants
   later. With it off, orders should still get a plain, no-cost label
   (sender/receiver info only, no rates/purchase/tracking).
2. The order-detail page's Details card mixes two visual patterns — some
   rows are label-above-value, others are label-left/value-right — and
   should be made consistent: label on the left, data on the right, for
   every row.

## Part 1 — Per-tenant gating (mirrors the AI feature pattern)

The existing AI-visibility toggle (`control.tenants.ai_enabled` +
`hasAiFeatures(plan)`) is the model. Shipping labels are **not** tied to a
plan — this is a pure per-tenant on/off switch, since EasyPost purchasing
isn't part of the pricing tiers.

- **DB**: new control-plane migration adds
  `control.tenants.shipping_labels_enabled boolean NOT NULL DEFAULT false`.
- **Admin toggle** (`/admin/tenants/[id]`): `TenantDetailActions.tsx` gets a
  `Truck`-icon "Shipping Labels: On/Off" button, identical shape to the
  existing "AI: On/Off" button — opens a `ConfirmActionModal`, PATCHes
  `{ shipping_labels_enabled: !tenant.shipping_labels_enabled }` to
  `/api/admin/tenants/[id]`. The PATCH route's diff logic gets one more
  `!== undefined` line, same treatment as `ai_enabled` (a platform admin
  explicitly setting it to `false` must still write).
- **Hydration**: `dashboard/layout.tsx`'s existing `control.tenants` query
  (which already selects `plan, ai_enabled`) also selects
  `shipping_labels_enabled`, passed through `StoreProvider` into
  `currentUserSlice.shippingLabelsEnabled` (initial state `false` —
  fail-closed, same rationale as `aiEnabled`).
- **Server enforcement**: `src/app/api/shipping/rates/route.ts` and
  `src/app/api/shipping/buy/route.ts` currently only call
  `requireIntegrationAdmin()` (a role check, plan/tenant-flag-blind). Add
  `requireShippingLabelAccess()` (new — `src/lib/shipping/authGuard.ts`,
  mirroring `src/lib/ai/authGuard.ts`'s shape) that reads
  `control.tenants.shipping_labels_enabled` and returns 403 when off. Both
  routes call it first, before the existing role check and address mapping.
  This is the real enforcement — the UI hiding below is presentation only.
- **Client UI**: order-detail page computes
  `shippingLabelsVisible = useAppSelector(s => s.currentUser.shippingLabelsEnabled)`.
  - `true`: Shipping card behaves exactly as it does today — unchanged
    `GenerateLabelModal` / rates / purchase / tracking / "Download Label"
    flow.
  - `false` (the default): Shipping card renders the plain-label flow
    (Part 2) instead. No EasyPost call is ever made.

## Part 2 — Plain label (the default experience)

No new API route, DB table, or modal — mirrors the existing "Download
Invoice" button: a pure client-side PDF download.

- New `src/lib/shipping/generatePlainLabel.ts`:
  `generatePlainShippingLabel(sale: Sale, companyProfile: CompanyProfile)`.
  Dynamically imports `jsPDF` (same avoid-SSR pattern as
  `lib/utils/generateInvoice.ts`; `jspdf` is already a dependency, no new
  package). Reuses the **existing** `addressFromCompanyProfile(companyProfile)`
  / `addressFromSale(sale)` mappers from `src/lib/shipping/addressMappers.ts`
  (same throw-on-missing-field validation already written for EasyPost) to
  get sender/receiver blocks. Renders one page: "SHIP FROM" block, "SHIP TO"
  block (larger, label-style), order ID + date footer. No tracking, carrier,
  rates, or cost. `doc.save(...)` triggers the download, same as invoices.
- **Order-detail page wiring** — when `shippingLabelsVisible` is `false`:
  - Addresses incomplete → same muted "Add a sender address in Settings…"
    message as today (unchanged).
  - Addresses complete → a secondary `Button`, `Download` icon, labeled
    **"Download Shipping Label"**, `onClick` calls
    `generatePlainShippingLabel(sale, companyProfile)` directly (no modal,
    no network call). **Not** gated by `canGenerateLabel` — open to anyone
    who can view the order, matching the existing Download Invoice button's
    access level (a free, no-purchase print action).
  - No persisted "shipment exists" state — nothing is purchased, so the
    button is always available/re-downloadable, same as Download Invoice.
- When `shippingLabelsVisible` is `true`, the card's code path is completely
  unchanged from today.

## Part 3 — Details card: label-left / data-right

`sales/[id]/page.tsx`'s Details card currently mixes two row shapes:
`FinRow` (label left, value right-aligned, single line — used for Linked
Product/Created By/Created At) and ad-hoc stacked `<dt>`/`<dd>` blocks
(label above, value below — used for Description and Shipping Address).

Add one local helper next to the existing `FinRow` (bottom of the file):

```tsx
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt className="text-(--color-text-muted) shrink-0 w-32">{label}</dt>
      <dd className="text-(--color-text-base) text-left flex-1">{children}</dd>
    </div>
  );
}
```

Use `DetailRow` for **Description** and **Shipping Address** (the two blocks
that don't fit `FinRow`'s right-aligned single-line shape — multi-line
address content reads better left-aligned). `FinRow` itself is untouched —
still used for Linked Product/Created By/Created At, which already match the
label-left/data-right pattern. Net effect: every row in the Details card
becomes a two-column row, label at a fixed-width left column, value filling
the right column.

## Out of scope

- Re-enabling EasyPost for any tenant (a later `/admin` toggle flip, no code
  change needed once this ships).
- Per-tenant EasyPost credentials (still the shared platform key, unchanged
  — noted as accepted future work in `shipping/SKILL.md`).
- Persisting/reprinting a history of plain labels — always regenerated
  on click, same as invoices.
- Changing the Financials card or any other page's layout.

## Testing

- `src/lib/shipping/generatePlainLabel.ts` is a thin jsPDF wrapper around
  already-tested pure mappers (`addressMappers.test.ts` covers the
  throw-on-missing-field behavior) — no new unit tests needed beyond
  confirming it's called with the right arguments, which isn't practically
  testable without rendering PDF internals (consistent with
  `generateInvoice.ts` having no direct unit test either).
- Manual verification in the browser (per this repo's working agreement):
  toggle on/off in `/admin`, confirm the Shipping card switches between the
  plain button and the EasyPost flow, confirm the plain PDF downloads with
  correct sender/receiver info, confirm the Details card renders label-left/
  data-right for every row.
