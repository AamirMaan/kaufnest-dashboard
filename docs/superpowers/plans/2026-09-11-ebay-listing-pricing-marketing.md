# eBay Listing Pricing, Offers, Advertising & Optional Specifics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a seller set VAT, Best Offer, a multi-buy discount, a Promoted Listings ad rate and optional item specifics on the create-listing form, so nothing has to be finished in eBay Seller Hub.

**Architecture:** VAT and Best Offer ride the existing Inventory API offer payload. After `publishOffer` succeeds, the same publish route runs `runMarketingSteps` (Marketing API): add the listing to a cost-per-sale campaign, then create a `VOLUME_DISCOUNT` item promotion. Each step persists the id eBay returns, so a retry (`apply-marketing` route) skips whatever already succeeded; a marketing failure never un-publishes the listing. Optional item specifics come from the same Taxonomy call that already feeds required ones.

**Tech Stack:** Next.js App Router (this repo's version — read `node_modules/next/dist/docs/` before touching route conventions), Supabase (per-tenant schemas, RLS), Redux Toolkit, Jest (`testEnvironment: node`), eBay Inventory / Marketing / Taxonomy REST APIs.

**Spec:** `docs/superpowers/specs/2026-09-11-ebay-listing-pricing-marketing-design.md`

## Global Constraints

- Work on branch `feat/listing-pricing-marketing` (already created, spec committed).
- Tenant DDL only via `public.run_on_all_tenant_schemas($$ … {{schema}} … $$)`, **and** mirror every column into `provision_tenant_schema()` in `supabase/migrations/005_tenant_provisioning.sql` (2-places rule).
- Never query `public.*`; never hardcode a tenant schema name.
- `src/lib/integrations/**` is server-only — never import it (not even types) from a `"use client"` file. Client code duplicates wire types locally.
- Every `<button>` rendered inside `ListingForm.tsx`'s `<form>` is `type="button"` — the form's only submit button (Publish) lives outside it, and a default-`submit` button inside would publish to eBay.
- A field marked `<Field required>` must also pass `required` to its `<Input>/<Select>`.
- Every mutation toasts on success **and** failure; busy buttons show a verb ("Retrying…").
- Colors/radii only via `var(--color-*)` / `--radius-*` tokens; icons from `lucide-react`; type scale as in `AGENTS.md`.
- Ad rate bounds: **2.0–100.0, one decimal**. Multi-buy tiers: **whole percent 1–80, strictly increasing, Buy 4+ requires Buy 3**. VAT: **0–100, two decimals**. (Provisional — Task 10 verifies in sandbox.)
- Don't run `npx tsc --noEmit` / `npm run lint` by hand — `.husky/pre-commit` runs tsc, eslint and the project verifier on every commit. If a commit fails, fix what it reports and re-run the same `git commit`.
- Run focused tests only: `npx jest <path>` from the repo root.
- Don't start the dev server or `curl` routes.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- Docs (`CLAUDE.md`/`SKILL.md` of the touched feature) are updated **in the same commit** as the code they describe.

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `supabase/migrations/044_ebay_listing_drafts_pricing_marketing.sql` | create | 12 new draft columns + CHECKs |
| `supabase/migrations/005_tenant_provisioning.sql` | modify | same columns for new tenants |
| `src/types/index.ts` | modify | `EbayListingDraft` fields |
| `src/lib/integrations/ebay/publishPayloads.ts` | modify | offer `tax`/`bestOfferTerms`; campaign/ad/volume-discount payload builders |
| `src/lib/integrations/ebay/aspects.ts` | create | pure Taxonomy aspect split (required vs optional) |
| `src/lib/integrations/ebay/publish.ts` | modify | export `ebayFetch`/`throwIfNotOk`/`MARKETPLACE_ID`; `fetchCategoryAspects` |
| `src/lib/integrations/ebay/marketing.ts` | create | Marketing API calls, `runMarketingSteps`, `applyMarketingToDraft` |
| `src/lib/integrations/ebay.ts` | modify | add `sell.marketing` to `EBAY_SCOPE` |
| `src/app/api/listings/ebay/campaigns/route.ts` | create | `GET` campaigns + `needsReconnect` |
| `src/app/api/listings/ebay/aspects/route.ts` | modify | also return `optionalAspects` |
| `src/app/api/listings/[id]/publish/route.ts` | modify | run marketing after publish; respond `{ draft, warnings }` |
| `src/app/api/listings/[id]/apply-marketing/route.ts` | create | retry marketing steps only |
| `src/app/dashboard/listings/_lib/wizardValidation.ts` | modify | new form fields, constants, `validatePricingStep`, `validateAdvertisingStep` |
| `src/app/dashboard/listings/_lib/campaignSelection.ts` | create | pure dropdown-default logic |
| `src/app/dashboard/listings/_lib/aspectFields.ts` | create | pure optional-aspect control choice + filled count |
| `src/app/dashboard/listings/_lib/multiBuy.ts` | create | pure preview lines for tiers |
| `src/app/dashboard/listings/_components/useEbayCampaigns.ts` | create | client hook: campaigns / reconnect / error |
| `src/app/dashboard/listings/_components/MarketingReconnectNotice.tsx` | create | "Reconnect eBay" notice |
| `src/app/dashboard/listings/_components/AdvertisingSection.tsx` | create | ad toggle, rate, campaign |
| `src/app/dashboard/listings/_components/PricingSection.tsx` | create | price/currency/quantity + VAT + Best Offer + multi-buy |
| `src/app/dashboard/listings/_components/OptionalAspectsGroup.tsx` | create | collapsible optional specifics |
| `src/app/dashboard/listings/_components/AspectsStep.tsx` | modify | render `OptionalAspectsGroup` |
| `src/app/dashboard/listings/_components/ListingForm.tsx` | modify | wire sections, state mapping, publish warnings |
| `src/app/dashboard/listings/_components/ListingPreview.tsx` | modify | "or Best Offer" + tiers |
| `src/app/dashboard/listings/_components/MarketingRetryBanner.tsx` | create | live-page retry banner |
| `src/app/dashboard/listings/[id]/live/page.tsx` | modify | render the banner |

---

### Task 1: Database columns and draft type

**Files:**
- Create: `supabase/migrations/044_ebay_listing_drafts_pricing_marketing.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql` (the `ebay_listing_drafts` `CREATE TABLE`, ~lines 326–356)
- Modify: `src/types/index.ts` (`EbayListingDraft`, ~line 364)
- Modify: `src/lib/integrations/ebay/publishPayloads.test.ts` (`makeDraft`)
- Modify: `src/app/dashboard/listings/_store/listingsSlice.test.ts` (`makeDraft`)
- Modify: `supabase/SKILL.md` (migration file-map table, after the `043` row)

**Interfaces:**
- Produces: `EbayListingDraft` gains
  `vat_percentage: number | null; best_offer_enabled: boolean; best_offer_auto_accept: number | null; best_offer_auto_decline: number | null; multibuy_2_pct: number | null; multibuy_3_pct: number | null; multibuy_4_pct: number | null; ad_rate: number | null; ad_campaign_id: string | null; ebay_ad_id: string | null; ebay_promotion_id: string | null; marketing_error: string | null;`

- [ ] **Step 1: Write the migration**

`supabase/migrations/044_ebay_listing_drafts_pricing_marketing.sql`:

```sql
-- ============================================================
-- 044 — pricing, offers and marketing on ebay_listing_drafts
--
-- Lets the create-listing form carry everything a seller would otherwise
-- finish in eBay Seller Hub: VAT %, Best Offer (+ auto-accept/decline),
-- a multi-buy volume discount (Buy 2 / 3 / 4+), and a Promoted Listings
-- cost-per-sale ad rate + campaign. The ebay_ad_id / ebay_promotion_id
-- columns record what eBay actually created after publish, so the
-- apply-marketing retry can skip steps that already succeeded;
-- marketing_error holds the last post-publish failure (the listing itself
-- stays published). See
-- docs/superpowers/specs/2026-09-11-ebay-listing-pricing-marketing-design.md.
--
-- Also mirrored into provision_tenant_schema() (005) — the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.ebay_listing_drafts
    add column if not exists vat_percentage numeric(5,2)
      check (vat_percentage is null or (vat_percentage >= 0 and vat_percentage <= 100)),
    add column if not exists best_offer_enabled boolean not null default false,
    add column if not exists best_offer_auto_accept numeric(12,2)
      check (best_offer_auto_accept is null or best_offer_auto_accept > 0),
    add column if not exists best_offer_auto_decline numeric(12,2)
      check (best_offer_auto_decline is null or best_offer_auto_decline > 0),
    add column if not exists multibuy_2_pct smallint
      check (multibuy_2_pct is null or multibuy_2_pct between 1 and 80),
    add column if not exists multibuy_3_pct smallint
      check (multibuy_3_pct is null or multibuy_3_pct between 1 and 80),
    add column if not exists multibuy_4_pct smallint
      check (multibuy_4_pct is null or multibuy_4_pct between 1 and 80),
    add column if not exists ad_rate numeric(4,1)
      check (ad_rate is null or ad_rate between 2 and 100),
    add column if not exists ad_campaign_id text,
    add column if not exists ebay_ad_id text,
    add column if not exists ebay_promotion_id text,
    add column if not exists marketing_error text;

  alter table {{schema}}.ebay_listing_drafts
    drop constraint if exists ebay_listing_drafts_best_offer_order;
  alter table {{schema}}.ebay_listing_drafts
    add constraint ebay_listing_drafts_best_offer_order check (
      best_offer_auto_accept is null
      or best_offer_auto_decline is null
      or best_offer_auto_decline < best_offer_auto_accept
    );
$$);
```

- [ ] **Step 2: Mirror the columns into `provision_tenant_schema()`**

In `supabase/migrations/005_tenant_provisioning.sql`, inside `CREATE TABLE IF NOT EXISTS %1$I.ebay_listing_drafts (`, replace:

```sql
      publish_error          text,
      created_by             uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.ebay_messages (
```

with:

```sql
      publish_error          text,
      vat_percentage         numeric(5,2) CHECK (vat_percentage IS NULL OR (vat_percentage >= 0 AND vat_percentage <= 100)),
      best_offer_enabled     boolean NOT NULL DEFAULT false,
      best_offer_auto_accept numeric(12,2) CHECK (best_offer_auto_accept IS NULL OR best_offer_auto_accept > 0),
      best_offer_auto_decline numeric(12,2) CHECK (best_offer_auto_decline IS NULL OR best_offer_auto_decline > 0),
      multibuy_2_pct         smallint CHECK (multibuy_2_pct IS NULL OR multibuy_2_pct BETWEEN 1 AND 80),
      multibuy_3_pct         smallint CHECK (multibuy_3_pct IS NULL OR multibuy_3_pct BETWEEN 1 AND 80),
      multibuy_4_pct         smallint CHECK (multibuy_4_pct IS NULL OR multibuy_4_pct BETWEEN 1 AND 80),
      ad_rate                numeric(4,1) CHECK (ad_rate IS NULL OR ad_rate BETWEEN 2 AND 100),
      ad_campaign_id         text,
      ebay_ad_id             text,
      ebay_promotion_id      text,
      marketing_error        text,
      created_by             uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ebay_listing_drafts_best_offer_order CHECK (
        best_offer_auto_accept IS NULL
        OR best_offer_auto_decline IS NULL
        OR best_offer_auto_decline < best_offer_auto_accept
      )
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.ebay_messages (
```

- [ ] **Step 3: Extend the type**

In `src/types/index.ts`, inside `export interface EbayListingDraft`, after `publish_error: string | null;` add:

```ts
  /** VAT % sent as the offer's tax.vatPercentage; null = not sent. */
  vat_percentage: number | null;
  best_offer_enabled: boolean;
  best_offer_auto_accept: number | null;
  best_offer_auto_decline: number | null;
  /** Multi-buy tiers (whole %). multibuy_2_pct non-null = multi-buy on. */
  multibuy_2_pct: number | null;
  multibuy_3_pct: number | null;
  multibuy_4_pct: number | null;
  /** Promoted Listings ad rate %; null = not promoted. */
  ad_rate: number | null;
  /** Chosen campaign; null with ad_rate set = create one at publish. */
  ad_campaign_id: string | null;
  /** What eBay created after publish — retries skip a step whose id is set. */
  ebay_ad_id: string | null;
  ebay_promotion_id: string | null;
  /** Last post-publish marketing failure; the listing itself stays live. */
  marketing_error: string | null;
```

- [ ] **Step 4: Update both test fixtures**

In `src/lib/integrations/ebay/publishPayloads.test.ts` `makeDraft`, and in `src/app/dashboard/listings/_store/listingsSlice.test.ts` `makeDraft`, after the `publish_error: null,` line add:

```ts
    vat_percentage: null,
    best_offer_enabled: false,
    best_offer_auto_accept: null,
    best_offer_auto_decline: null,
    multibuy_2_pct: null,
    multibuy_3_pct: null,
    multibuy_4_pct: null,
    ad_rate: null,
    ad_campaign_id: null,
    ebay_ad_id: null,
    ebay_promotion_id: null,
    marketing_error: null,
```

(Match the indentation of the surrounding lines — `listingsSlice.test.ts` uses an arrow returning an object literal.)

- [ ] **Step 5: Run the affected tests**

Run: `npx jest src/lib/integrations/ebay/publishPayloads.test.ts src/app/dashboard/listings/_store`
Expected: PASS (no behaviour changed).

- [ ] **Step 6: Add the migration row to `supabase/SKILL.md`**

After the `migrations/043_shipments.sql` row of the file-map table, add:

```markdown
| `migrations/044_ebay_listing_drafts_pricing_marketing.sql` | all `tenant_%` schemas | ⏳ **pending** — adds 12 columns to `ebay_listing_drafts` via `run_on_all_tenant_schemas`: `vat_percentage`, `best_offer_enabled`/`best_offer_auto_accept`/`best_offer_auto_decline` (+ CHECK decline < accept), `multibuy_2_pct`/`_3_pct`/`_4_pct`, `ad_rate`, `ad_campaign_id`, and the post-publish results `ebay_ad_id`/`ebay_promotion_id`/`marketing_error`. Also mirrored into `provision_tenant_schema()` in the same commit (re-apply `005` so new tenants get them). Backs `src/app/dashboard/listings/` — see `docs/superpowers/specs/2026-09-11-ebay-listing-pricing-marketing-design.md`. |
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/044_ebay_listing_drafts_pricing_marketing.sql supabase/migrations/005_tenant_provisioning.sql src/types/index.ts src/lib/integrations/ebay/publishPayloads.test.ts src/app/dashboard/listings/_store/listingsSlice.test.ts supabase/SKILL.md
git commit -m "feat(listings): draft columns for VAT, Best Offer, multi-buy and ads

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

If pre-commit's `tsc` reports another object literal typed `EbayListingDraft` missing the new properties, add the same 12 fields (nulls / `false`) there and re-run the commit.

---

### Task 2: VAT and Best Offer in the offer payload

**Files:**
- Modify: `src/lib/integrations/ebay/publishPayloads.ts`
- Test: `src/lib/integrations/ebay/publishPayloads.test.ts`
- Modify: `src/app/dashboard/listings/CLAUDE.md` (`## Publish flow`)

**Interfaces:**
- Consumes: `EbayListingDraft` fields from Task 1.
- Produces: `OfferPayload` gains optional `tax?: { vatPercentage: number; applyTax: true }` and `listingPolicies.bestOfferTerms?: BestOfferTerms`; exported `interface Amount { value: string; currency: string }`, `interface BestOfferTerms { bestOfferEnabled: true; autoAcceptPrice?: Amount; autoDeclinePrice?: Amount }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/integrations/ebay/publishPayloads.test.ts`:

```ts
describe("buildOfferPayload — VAT and Best Offer", () => {
  it("sends neither tax nor bestOfferTerms when they are not set", () => {
    const payload = buildOfferPayload(makeDraft(), "EBAY_DE", "loc-1");
    expect(payload).not.toHaveProperty("tax");
    expect(payload.listingPolicies).not.toHaveProperty("bestOfferTerms");
  });

  it("sends VAT as tax.vatPercentage with applyTax", () => {
    const payload = buildOfferPayload(makeDraft({ vat_percentage: 19 }), "EBAY_DE", "loc-1");
    expect(payload.tax).toEqual({ vatPercentage: 19, applyTax: true });
  });

  it("sends a 0% VAT rate instead of dropping it", () => {
    const payload = buildOfferPayload(makeDraft({ vat_percentage: 0 }), "EBAY_DE", "loc-1");
    expect(payload.tax).toEqual({ vatPercentage: 0, applyTax: true });
  });

  it("enables Best Offer without thresholds", () => {
    const payload = buildOfferPayload(
      makeDraft({ best_offer_enabled: true }),
      "EBAY_DE",
      "loc-1"
    );
    expect(payload.listingPolicies.bestOfferTerms).toEqual({ bestOfferEnabled: true });
  });

  it("formats Best Offer thresholds as two-decimal amounts in the listing currency", () => {
    const payload = buildOfferPayload(
      makeDraft({
        best_offer_enabled: true,
        best_offer_auto_accept: 18,
        best_offer_auto_decline: 15.5,
      }),
      "EBAY_DE",
      "loc-1"
    );
    expect(payload.listingPolicies.bestOfferTerms).toEqual({
      bestOfferEnabled: true,
      autoAcceptPrice: { value: "18.00", currency: "EUR" },
      autoDeclinePrice: { value: "15.50", currency: "EUR" },
    });
  });

  it("ignores thresholds left on the row when Best Offer is off", () => {
    const payload = buildOfferPayload(
      makeDraft({ best_offer_enabled: false, best_offer_auto_accept: 18 }),
      "EBAY_DE",
      "loc-1"
    );
    expect(payload.listingPolicies).not.toHaveProperty("bestOfferTerms");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/lib/integrations/ebay/publishPayloads.test.ts`
Expected: FAIL — `tax` undefined / `bestOfferTerms` undefined in the new cases (the "neither" case passes).

- [ ] **Step 3: Implement**

In `src/lib/integrations/ebay/publishPayloads.ts`, replace the `OfferPayload` interface and `buildOfferPayload` with:

```ts
export interface Amount {
  value: string;
  currency: string;
}

export interface BestOfferTerms {
  bestOfferEnabled: true;
  autoAcceptPrice?: Amount;
  autoDeclinePrice?: Amount;
}

export interface OfferPayload {
  sku: string;
  marketplaceId: string;
  format: "FIXED_PRICE";
  availableQuantity: number;
  categoryId: string;
  listingDescription: string;
  pricingSummary: { price: Amount };
  listingPolicies: {
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
    bestOfferTerms?: BestOfferTerms;
  };
  tax?: { vatPercentage: number; applyTax: true };
  merchantLocationKey: string;
}

function amount(value: number, currency: string): Amount {
  return { value: value.toFixed(2), currency };
}

// Thresholds are only meaningful while Best Offer is on — a row can still
// hold them after the seller switched Best Offer off, and sending them then
// would re-enable nothing but could still fail eBay's validation.
function buildBestOfferTerms(draft: EbayListingDraft): BestOfferTerms | undefined {
  if (!draft.best_offer_enabled) return undefined;
  const terms: BestOfferTerms = { bestOfferEnabled: true };
  if (draft.best_offer_auto_accept != null) {
    terms.autoAcceptPrice = amount(draft.best_offer_auto_accept, draft.currency);
  }
  if (draft.best_offer_auto_decline != null) {
    terms.autoDeclinePrice = amount(draft.best_offer_auto_decline, draft.currency);
  }
  return terms;
}

export function buildOfferPayload(
  draft: EbayListingDraft,
  marketplaceId: string,
  merchantLocationKey: string
): OfferPayload {
  const bestOfferTerms = buildBestOfferTerms(draft);
  return {
    sku: draft.ebay_sku ?? "",
    marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: draft.quantity,
    categoryId: draft.category_id ?? "",
    listingDescription: draft.description
      ? sanitizeListingHtml(draft.description)
      : draft.title,
    pricingSummary: { price: amount(draft.price, draft.currency) },
    listingPolicies: {
      fulfillmentPolicyId: draft.fulfillment_policy_id ?? "",
      paymentPolicyId: draft.payment_policy_id ?? "",
      returnPolicyId: draft.return_policy_id ?? "",
      ...(bestOfferTerms ? { bestOfferTerms } : {}),
    },
    // `!= null`, not truthiness: 0% VAT is a real rate and must be sent.
    ...(draft.vat_percentage != null
      ? { tax: { vatPercentage: draft.vat_percentage, applyTax: true as const } }
      : {}),
    merchantLocationKey,
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest src/lib/integrations/ebay/publishPayloads.test.ts`
Expected: PASS (all old cases too — the conditional spreads leave no `undefined` keys, so existing `toEqual` assertions are unaffected).

- [ ] **Step 5: Update docs**

In `src/app/dashboard/listings/CLAUDE.md`, at the end of the `## Publish flow` section's paragraph (after "…(`sell.inventory`, already granted)."), append:

```markdown

**VAT and Best Offer (2026-09-11)** ride the same offer call:
`buildOfferPayload` adds `tax: { vatPercentage, applyTax: true }` when
`vat_percentage` is non-null (0 is sent — it's a real rate) and
`listingPolicies.bestOfferTerms` (with optional two-decimal
`autoAcceptPrice`/`autoDeclinePrice`) only when `best_offer_enabled` —
thresholds left on a row with Best Offer off are ignored.
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/integrations/ebay/publishPayloads.ts src/lib/integrations/ebay/publishPayloads.test.ts src/app/dashboard/listings/CLAUDE.md
git commit -m "feat(listings): send VAT and Best Offer terms on the eBay offer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Marketing API module (campaigns, ads, multi-buy) + scope

**Files:**
- Modify: `src/lib/integrations/ebay/publishPayloads.ts` (campaign/ad/volume-discount builders)
- Test: `src/lib/integrations/ebay/publishPayloads.test.ts`
- Modify: `src/lib/integrations/ebay/publish.ts` (export three helpers)
- Create: `src/lib/integrations/ebay/marketing.ts`
- Test: `src/lib/integrations/ebay/marketing.test.ts`
- Modify: `src/lib/integrations/ebay.ts` (`EBAY_SCOPE` + comment)
- Modify: `src/lib/integrations/SKILL.md` (new section)

**Interfaces:**
- Consumes: `EbayListingDraft` (Task 1).
- Produces (in `publishPayloads.ts`):
  - `interface MultiBuyTiers { buy2: number; buy3: number | null; buy4: number | null }`
  - `multiBuyTiersFromDraft(draft: EbayListingDraft): MultiBuyTiers | null`
  - `buildCampaignPayload(marketplaceId: string, now: Date, rate: number): CampaignPayload`
  - `buildAdPayload(listingId: string, rate: number): { listingId: string; bidPercentage: string }`
  - `buildVolumeDiscountPayload(listingId: string, tiers: MultiBuyTiers, marketplaceId: string, now: Date): VolumeDiscountPayload`
- Produces (in `publish.ts`): `export` on existing `ebayFetch`, `throwIfNotOk`, `MARKETPLACE_ID`.
- Produces (in `marketing.ts`):
  - `RECONNECT_MESSAGE: string`
  - `interface CampaignSummary { id: string; name: string }`
  - `interface RawCampaign { campaignId: string; campaignName: string; campaignStatus: string; marketplaceId: string; fundingStrategy?: { fundingModel?: string }; campaignCriterion?: { selectionRules?: unknown[] } | null }`
  - `filterManualCampaigns(campaigns: RawCampaign[], marketplaceId: string): CampaignSummary[]`
  - `idFromLocation(location: string | null): string`
  - `fetchManualCampaigns(accessToken: string): Promise<{ campaigns: CampaignSummary[]; needsReconnect: boolean }>`
  - `interface MarketingApi { createCampaign(rate: number): Promise<string>; addListingToCampaign(campaignId: string, listingId: string, rate: number): Promise<string>; createVolumeDiscount(listingId: string, tiers: MultiBuyTiers): Promise<string> }`
  - `type MarketingPatch = Partial<Pick<EbayListingDraft, "ad_campaign_id" | "ebay_ad_id" | "ebay_promotion_id" | "marketing_error">>`
  - `createMarketingApi(accessToken: string): MarketingApi`
  - `runMarketingSteps(draft: EbayListingDraft, listingId: string, api: MarketingApi, persist: (patch: MarketingPatch) => Promise<void>): Promise<string[]>` — returns warnings
  - `applyMarketingToDraft(client: IntegrationAuthContext["client"], draft: EbayListingDraft, accessToken: string): Promise<{ draft: EbayListingDraft; warnings: string[] }>`

- [ ] **Step 1: Write the failing payload-builder tests**

Append to `src/lib/integrations/ebay/publishPayloads.test.ts` (and add the new names to its import line: `buildAdPayload, buildCampaignPayload, buildVolumeDiscountPayload, multiBuyTiersFromDraft`):

```ts
describe("multiBuyTiersFromDraft", () => {
  it("returns null when Buy 2 is not set", () => {
    expect(multiBuyTiersFromDraft(makeDraft())).toBeNull();
  });

  it("returns every tier, keeping unset ones null", () => {
    expect(
      multiBuyTiersFromDraft(makeDraft({ multibuy_2_pct: 2, multibuy_3_pct: 4 }))
    ).toEqual({ buy2: 2, buy3: 4, buy4: null });
  });
});

describe("buildCampaignPayload", () => {
  it("builds a cost-per-sale campaign named after its creation time", () => {
    const now = new Date("2026-09-11T14:03:22.000Z");
    expect(buildCampaignPayload("EBAY_DE", now, 13)).toEqual({
      campaignName: "Boughtopia listings 2026-09-11 14:03:22",
      marketplaceId: "EBAY_DE",
      startDate: "2026-09-11T14:03:22.000Z",
      fundingStrategy: { fundingModel: "COST_PER_SALE", bidPercentage: "13.0" },
    });
  });
});

describe("buildAdPayload", () => {
  it("sends the rate as a one-decimal string", () => {
    expect(buildAdPayload("110553", 13)).toEqual({ listingId: "110553", bidPercentage: "13.0" });
    expect(buildAdPayload("110553", 16.3)).toEqual({ listingId: "110553", bidPercentage: "16.3" });
  });
});

describe("buildVolumeDiscountPayload", () => {
  const now = new Date("2026-09-11T14:03:22.000Z");

  it("prepends eBay's 0% single-item rule and orders the tiers", () => {
    const payload = buildVolumeDiscountPayload(
      "110553",
      { buy2: 2, buy3: 4, buy4: 15 },
      "EBAY_DE",
      now
    );
    expect(payload).toEqual({
      name: "Multi-buy 110553",
      description: "Buy more, save more",
      marketplaceId: "EBAY_DE",
      promotionType: "VOLUME_DISCOUNT",
      promotionStatus: "SCHEDULED",
      startDate: "2026-09-11T14:03:22.000Z",
      inventoryCriterion: {
        inventoryCriterionType: "INVENTORY_BY_VALUE",
        listingIds: ["110553"],
      },
      discountRules: [
        { ruleOrder: 1, discountSpecifier: { minQuantity: 1 }, discountBenefit: { percentageOffItem: "0" } },
        { ruleOrder: 2, discountSpecifier: { minQuantity: 2 }, discountBenefit: { percentageOffItem: "2" } },
        { ruleOrder: 3, discountSpecifier: { minQuantity: 3 }, discountBenefit: { percentageOffItem: "4" } },
        { ruleOrder: 4, discountSpecifier: { minQuantity: 4 }, discountBenefit: { percentageOffItem: "15" } },
      ],
    });
  });

  it("drops unset Buy 3 / Buy 4+ tiers", () => {
    const payload = buildVolumeDiscountPayload(
      "110553",
      { buy2: 10, buy3: null, buy4: null },
      "EBAY_DE",
      now
    );
    expect(payload.discountRules).toEqual([
      { ruleOrder: 1, discountSpecifier: { minQuantity: 1 }, discountBenefit: { percentageOffItem: "0" } },
      { ruleOrder: 2, discountSpecifier: { minQuantity: 2 }, discountBenefit: { percentageOffItem: "10" } },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/lib/integrations/ebay/publishPayloads.test.ts`
Expected: FAIL — `multiBuyTiersFromDraft is not a function` (and the other three).

- [ ] **Step 3: Implement the builders**

Append to `src/lib/integrations/ebay/publishPayloads.ts`:

```ts
// ─── Marketing API payloads (Promoted Listings + volume discount) ──────────────

export interface MultiBuyTiers {
  buy2: number;
  buy3: number | null;
  buy4: number | null;
}

/** `multibuy_2_pct` is the on/off switch: no Buy 2 tier means no multi-buy. */
export function multiBuyTiersFromDraft(draft: EbayListingDraft): MultiBuyTiers | null {
  if (draft.multibuy_2_pct == null) return null;
  return { buy2: draft.multibuy_2_pct, buy3: draft.multibuy_3_pct, buy4: draft.multibuy_4_pct };
}

export interface CampaignPayload {
  campaignName: string;
  marketplaceId: string;
  startDate: string;
  fundingStrategy: { fundingModel: "COST_PER_SALE"; bidPercentage: string };
}

// eBay campaign names must be unique per seller, so the name carries the
// creation time to the second — the same shape Seller Hub uses for its own
// auto-created campaigns ("Campaign 13.05.2026 17:18:00").
export function buildCampaignPayload(
  marketplaceId: string,
  now: Date,
  rate: number
): CampaignPayload {
  const iso = now.toISOString();
  return {
    campaignName: `Boughtopia listings ${iso.slice(0, 19).replace("T", " ")}`,
    marketplaceId,
    startDate: iso,
    fundingStrategy: { fundingModel: "COST_PER_SALE", bidPercentage: rate.toFixed(1) },
  };
}

export function buildAdPayload(
  listingId: string,
  rate: number
): { listingId: string; bidPercentage: string } {
  return { listingId, bidPercentage: rate.toFixed(1) };
}

interface DiscountRule {
  ruleOrder: number;
  discountSpecifier: { minQuantity: number };
  discountBenefit: { percentageOffItem: string };
}

export interface VolumeDiscountPayload {
  name: string;
  description: string;
  marketplaceId: string;
  promotionType: "VOLUME_DISCOUNT";
  promotionStatus: "SCHEDULED";
  startDate: string;
  inventoryCriterion: { inventoryCriterionType: "INVENTORY_BY_VALUE"; listingIds: string[] };
  discountRules: DiscountRule[];
}

// eBay volume pricing starts from a mandatory 1-item / 0% rule; the seller's
// tiers follow it in order, and unset optional tiers are simply left out.
export function buildVolumeDiscountPayload(
  listingId: string,
  tiers: MultiBuyTiers,
  marketplaceId: string,
  now: Date
): VolumeDiscountPayload {
  const steps: Array<[number, number | null]> = [
    [1, 0],
    [2, tiers.buy2],
    [3, tiers.buy3],
    [4, tiers.buy4],
  ];
  const discountRules = steps
    .filter((step): step is [number, number] => step[1] != null)
    .map(([minQuantity, pct], index) => ({
      ruleOrder: index + 1,
      discountSpecifier: { minQuantity },
      discountBenefit: { percentageOffItem: String(pct) },
    }));

  return {
    name: `Multi-buy ${listingId}`,
    description: "Buy more, save more",
    marketplaceId,
    promotionType: "VOLUME_DISCOUNT",
    promotionStatus: "SCHEDULED",
    startDate: now.toISOString(),
    inventoryCriterion: { inventoryCriterionType: "INVENTORY_BY_VALUE", listingIds: [listingId] },
    discountRules,
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest src/lib/integrations/ebay/publishPayloads.test.ts`
Expected: PASS

- [ ] **Step 5: Export the shared HTTP helpers from `publish.ts`**

In `src/lib/integrations/ebay/publish.ts` change three declarations (no other edits):

```ts
export const MARKETPLACE_ID = process.env.EBAY_MARKETPLACE_ID || "EBAY_DE";
```
```ts
export async function ebayFetch(path: string, accessToken: string, init?: RequestInit): Promise<Response> {
```
```ts
export async function throwIfNotOk(res: Response, action: string): Promise<void> {
```

- [ ] **Step 6: Write the failing `marketing.test.ts`**

Create `src/lib/integrations/ebay/marketing.test.ts`:

```ts
import {
  filterManualCampaigns,
  idFromLocation,
  fetchManualCampaigns,
  runMarketingSteps,
  RECONNECT_MESSAGE,
  type MarketingApi,
  type MarketingPatch,
  type RawCampaign,
} from "./marketing";
import type { EbayListingDraft } from "@/types";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function campaign(overrides: Partial<RawCampaign> = {}): RawCampaign {
  return {
    campaignId: "c-1",
    campaignName: "Campaign 13.05.2026 17:18:00",
    campaignStatus: "RUNNING",
    marketplaceId: "EBAY_DE",
    fundingStrategy: { fundingModel: "COST_PER_SALE" },
    ...overrides,
  };
}

describe("filterManualCampaigns", () => {
  it("keeps running and scheduled cost-per-sale campaigns on the marketplace", () => {
    const result = filterManualCampaigns(
      [campaign(), campaign({ campaignId: "c-2", campaignName: "Later", campaignStatus: "SCHEDULED" })],
      "EBAY_DE"
    );
    expect(result).toEqual([
      { id: "c-1", name: "Campaign 13.05.2026 17:18:00" },
      { id: "c-2", name: "Later" },
    ]);
  });

  it("drops rules-based, ended, other-marketplace and cost-per-click campaigns", () => {
    const result = filterManualCampaigns(
      [
        campaign({ campaignId: "rules", campaignCriterion: { selectionRules: [{}] } }),
        campaign({ campaignId: "ended", campaignStatus: "ENDED" }),
        campaign({ campaignId: "gb", marketplaceId: "EBAY_GB" }),
        campaign({ campaignId: "cpc", fundingStrategy: { fundingModel: "COST_PER_CLICK" } }),
      ],
      "EBAY_DE"
    );
    expect(result).toEqual([]);
  });

  it("keeps a campaign whose criterion has no selection rules", () => {
    const result = filterManualCampaigns(
      [campaign({ campaignCriterion: { selectionRules: [] } })],
      "EBAY_DE"
    );
    expect(result).toHaveLength(1);
  });
});

describe("idFromLocation", () => {
  it("returns the last path segment", () => {
    expect(
      idFromLocation("https://api.ebay.com/sell/marketing/v1/ad_campaign/123/ad/456")
    ).toBe("456");
  });

  it("throws when eBay sends no Location header", () => {
    expect(() => idFromLocation(null)).toThrow("did not return");
  });
});

describe("fetchManualCampaigns", () => {
  it("maps a 403 to needsReconnect instead of throwing", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;
    await expect(fetchManualCampaigns("token")).resolves.toEqual({
      campaigns: [],
      needsReconnect: true,
    });
  });

  it("treats 204 No Content as an empty list", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 }) as unknown as typeof fetch;
    await expect(fetchManualCampaigns("token")).resolves.toEqual({
      campaigns: [],
      needsReconnect: false,
    });
  });

  it("returns the filtered campaigns", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ campaigns: [campaign(), campaign({ campaignId: "x", campaignStatus: "ENDED" })] }),
    }) as unknown as typeof fetch;
    await expect(fetchManualCampaigns("token")).resolves.toEqual({
      campaigns: [{ id: "c-1", name: "Campaign 13.05.2026 17:18:00" }],
      needsReconnect: false,
    });
  });
});

function draft(overrides: Partial<EbayListingDraft> = {}): EbayListingDraft {
  return {
    id: "draft-1",
    source_type: "inventory",
    product_id: "p-1",
    source_url: null,
    source_platform: null,
    title: "Wallet",
    description: null,
    price: 16.62,
    currency: "EUR",
    quantity: 5,
    condition: "new",
    category_id: "45258",
    category_name: "Wallets",
    image_urls: [],
    aspects: {},
    origin: "app",
    fulfillment_policy_id: "fp",
    payment_policy_id: "pp",
    return_policy_id: "rp",
    merchant_location_key: "loc",
    ebay_sku: "KN1",
    status: "published",
    ebay_offer_id: "o-1",
    ebay_listing_id: "110553",
    publish_error: null,
    vat_percentage: null,
    best_offer_enabled: false,
    best_offer_auto_accept: null,
    best_offer_auto_decline: null,
    multibuy_2_pct: null,
    multibuy_3_pct: null,
    multibuy_4_pct: null,
    ad_rate: null,
    ad_campaign_id: null,
    ebay_ad_id: null,
    ebay_promotion_id: null,
    marketing_error: null,
    created_by: "u-1",
    created_at: "2026-09-11T10:00:00.000Z",
    updated_at: "2026-09-11T10:00:00.000Z",
    ...overrides,
  };
}

function fakeApi(overrides: Partial<MarketingApi> = {}): jest.Mocked<MarketingApi> {
  return {
    createCampaign: jest.fn().mockResolvedValue("new-campaign"),
    addListingToCampaign: jest.fn().mockResolvedValue("ad-1"),
    createVolumeDiscount: jest.fn().mockResolvedValue("promo-1"),
    ...overrides,
  } as jest.Mocked<MarketingApi>;
}

describe("runMarketingSteps", () => {
  it("does nothing and writes nothing when no marketing is requested", async () => {
    const api = fakeApi();
    const persist = jest.fn<(patch: MarketingPatch) => Promise<void>>().mockResolvedValue(undefined);
    await expect(runMarketingSteps(draft(), "110553", api, persist)).resolves.toEqual([]);
    expect(api.addListingToCampaign).not.toHaveBeenCalled();
    expect(api.createVolumeDiscount).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("adds the ad to the chosen campaign and records the ad id", async () => {
    const api = fakeApi();
    const persist = jest.fn<(patch: MarketingPatch) => Promise<void>>().mockResolvedValue(undefined);
    const warnings = await runMarketingSteps(
      draft({ ad_rate: 13, ad_campaign_id: "c-1" }),
      "110553",
      api,
      persist
    );
    expect(warnings).toEqual([]);
    expect(api.createCampaign).not.toHaveBeenCalled();
    expect(api.addListingToCampaign).toHaveBeenCalledWith("c-1", "110553", 13);
    expect(persist).toHaveBeenCalledWith({ ebay_ad_id: "ad-1" });
  });

  it("creates a campaign when none was chosen and saves its id before adding the ad", async () => {
    const api = fakeApi();
    const persist = jest.fn<(patch: MarketingPatch) => Promise<void>>().mockResolvedValue(undefined);
    await runMarketingSteps(draft({ ad_rate: 13 }), "110553", api, persist);
    expect(api.createCampaign).toHaveBeenCalledWith(13);
    expect(persist.mock.calls[0][0]).toEqual({ ad_campaign_id: "new-campaign" });
    expect(api.addListingToCampaign).toHaveBeenCalledWith("new-campaign", "110553", 13);
    expect(persist).toHaveBeenCalledWith({ ebay_ad_id: "ad-1" });
  });

  it("creates the volume discount and records the promotion id", async () => {
    const api = fakeApi();
    const persist = jest.fn<(patch: MarketingPatch) => Promise<void>>().mockResolvedValue(undefined);
    await runMarketingSteps(
      draft({ multibuy_2_pct: 2, multibuy_3_pct: 4, multibuy_4_pct: 15 }),
      "110553",
      api,
      persist
    );
    expect(api.createVolumeDiscount).toHaveBeenCalledWith("110553", { buy2: 2, buy3: 4, buy4: 15 });
    expect(persist).toHaveBeenCalledWith({ ebay_promotion_id: "promo-1" });
  });

  it("skips steps whose eBay id is already stored", async () => {
    const api = fakeApi();
    const persist = jest.fn<(patch: MarketingPatch) => Promise<void>>().mockResolvedValue(undefined);
    await runMarketingSteps(
      draft({ ad_rate: 13, ad_campaign_id: "c-1", ebay_ad_id: "ad-0", multibuy_2_pct: 2, ebay_promotion_id: "promo-0" }),
      "110553",
      api,
      persist
    );
    expect(api.addListingToCampaign).not.toHaveBeenCalled();
    expect(api.createVolumeDiscount).not.toHaveBeenCalled();
  });

  it("still runs multi-buy when the ad fails, and records the failure", async () => {
    const api = fakeApi({
      addListingToCampaign: jest.fn().mockRejectedValue(new Error("rate too low")),
    });
    const persist = jest.fn<(patch: MarketingPatch) => Promise<void>>().mockResolvedValue(undefined);
    const warnings = await runMarketingSteps(
      draft({ ad_rate: 13, ad_campaign_id: "c-1", multibuy_2_pct: 2 }),
      "110553",
      api,
      persist
    );
    expect(api.createVolumeDiscount).toHaveBeenCalled();
    expect(warnings).toEqual(["The ad couldn't be added: rate too low"]);
    expect(persist).toHaveBeenCalledWith({
      marketing_error: "The ad couldn't be added: rate too low",
    });
  });

  it("collects both failures", async () => {
    const api = fakeApi({
      addListingToCampaign: jest.fn().mockRejectedValue(new Error(RECONNECT_MESSAGE)),
      createVolumeDiscount: jest.fn().mockRejectedValue(new Error(RECONNECT_MESSAGE)),
    });
    const persist = jest.fn<(patch: MarketingPatch) => Promise<void>>().mockResolvedValue(undefined);
    const warnings = await runMarketingSteps(
      draft({ ad_rate: 13, ad_campaign_id: "c-1", multibuy_2_pct: 2 }),
      "110553",
      api,
      persist
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toBe(`The multi-buy discount couldn't be created: ${RECONNECT_MESSAGE}`);
  });

  it("clears a previous marketing_error once everything succeeds", async () => {
    const api = fakeApi();
    const persist = jest.fn<(patch: MarketingPatch) => Promise<void>>().mockResolvedValue(undefined);
    await runMarketingSteps(
      draft({ ad_rate: 13, ad_campaign_id: "c-1", marketing_error: "old failure" }),
      "110553",
      api,
      persist
    );
    expect(persist).toHaveBeenLastCalledWith({ marketing_error: null });
  });

  it("never throws when saving the final marketing_error fails", async () => {
    const api = fakeApi({
      addListingToCampaign: jest.fn().mockRejectedValue(new Error("boom")),
    });
    const persist = jest
      .fn<(patch: MarketingPatch) => Promise<void>>()
      .mockRejectedValue(new Error("db down"));
    await expect(
      runMarketingSteps(draft({ ad_rate: 13, ad_campaign_id: "c-1" }), "110553", api, persist)
    ).resolves.toEqual(["The ad couldn't be added: boom"]);
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npx jest src/lib/integrations/ebay/marketing.test.ts`
Expected: FAIL — `Cannot find module './marketing'`.

- [ ] **Step 8: Implement `marketing.ts`**

Create `src/lib/integrations/ebay/marketing.ts`:

```ts
// eBay Marketing API — Promoted Listings (cost-per-sale ads) and item
// promotions (multi-buy volume discounts). Server-only, like the rest of
// src/lib/integrations/. Needs the sell.marketing OAuth scope: a connection
// authorised before that scope was added gets 403 here until the tenant
// disconnects and reconnects eBay (see src/lib/integrations/SKILL.md).
import type { EbayListingDraft } from "@/types";
import type { IntegrationAuthContext } from "../authGuard";
import { ebayFetch, throwIfNotOk, MARKETPLACE_ID } from "./publish";
import {
  buildAdPayload,
  buildCampaignPayload,
  buildVolumeDiscountPayload,
  multiBuyTiersFromDraft,
  type MultiBuyTiers,
} from "./publishPayloads";

export const RECONNECT_MESSAGE =
  "Your eBay connection doesn't allow advertising or multi-buy discounts yet. Disconnect and reconnect eBay in Integrations, then retry.";

export interface CampaignSummary {
  id: string;
  name: string;
}

export interface RawCampaign {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  marketplaceId: string;
  fundingStrategy?: { fundingModel?: string };
  campaignCriterion?: { selectionRules?: unknown[] } | null;
}

const USABLE_STATUSES = new Set(["RUNNING", "SCHEDULED"]);

// Only campaigns a listing can be added to by hand: cost-per-sale, still
// running (or about to), on our marketplace, and NOT rules-based — eBay
// rejects manually added ads on a campaign that selects listings by rules.
export function filterManualCampaigns(
  campaigns: RawCampaign[],
  marketplaceId: string
): CampaignSummary[] {
  return campaigns
    .filter(
      (c) =>
        USABLE_STATUSES.has(c.campaignStatus) &&
        c.marketplaceId === marketplaceId &&
        c.fundingStrategy?.fundingModel === "COST_PER_SALE" &&
        !(c.campaignCriterion?.selectionRules?.length)
    )
    .map((c) => ({ id: c.campaignId, name: c.campaignName }));
}

/** eBay's create calls answer 201 with the new resource's URL in `Location`. */
export function idFromLocation(location: string | null): string {
  const id = location?.split("/").filter(Boolean).pop();
  if (!id) throw new Error("eBay did not return the new resource's id.");
  return id;
}

async function throwIfMarketingNotOk(res: Response, action: string): Promise<void> {
  if (res.status === 403) throw new Error(RECONNECT_MESSAGE);
  await throwIfNotOk(res, action);
}

export async function fetchManualCampaigns(
  accessToken: string
): Promise<{ campaigns: CampaignSummary[]; needsReconnect: boolean }> {
  const params = new URLSearchParams({
    campaign_status: "RUNNING,SCHEDULED",
    funding_strategy: "COST_PER_SALE",
    limit: "100",
  });
  const res = await ebayFetch(`/sell/marketing/v1/ad_campaign?${params.toString()}`, accessToken);
  // We don't store granted scopes, and eBay's token response doesn't list
  // them — a 403 here IS the "reconnect to grant sell.marketing" signal.
  if (res.status === 403) return { campaigns: [], needsReconnect: true };
  if (res.status === 204) return { campaigns: [], needsReconnect: false };
  await throwIfNotOk(res, "getCampaigns");
  const json = (await res.json()) as { campaigns?: RawCampaign[] };
  return {
    campaigns: filterManualCampaigns(json.campaigns ?? [], MARKETPLACE_ID),
    needsReconnect: false,
  };
}

export interface MarketingApi {
  createCampaign(rate: number): Promise<string>;
  addListingToCampaign(campaignId: string, listingId: string, rate: number): Promise<string>;
  createVolumeDiscount(listingId: string, tiers: MultiBuyTiers): Promise<string>;
}

export function createMarketingApi(accessToken: string): MarketingApi {
  return {
    async createCampaign(rate) {
      const res = await ebayFetch("/sell/marketing/v1/ad_campaign", accessToken, {
        method: "POST",
        body: JSON.stringify(buildCampaignPayload(MARKETPLACE_ID, new Date(), rate)),
      });
      await throwIfMarketingNotOk(res, "createCampaign");
      return idFromLocation(res.headers.get("Location"));
    },
    async addListingToCampaign(campaignId, listingId, rate) {
      const res = await ebayFetch(
        `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/ad`,
        accessToken,
        { method: "POST", body: JSON.stringify(buildAdPayload(listingId, rate)) }
      );
      await throwIfMarketingNotOk(res, "createAdByListingId");
      return idFromLocation(res.headers.get("Location"));
    },
    async createVolumeDiscount(listingId, tiers) {
      const res = await ebayFetch("/sell/marketing/v1/item_promotion", accessToken, {
        method: "POST",
        body: JSON.stringify(
          buildVolumeDiscountPayload(listingId, tiers, MARKETPLACE_ID, new Date())
        ),
      });
      await throwIfMarketingNotOk(res, "createItemPromotion");
      return idFromLocation(res.headers.get("Location"));
    },
  };
}

export type MarketingPatch = Partial<
  Pick<EbayListingDraft, "ad_campaign_id" | "ebay_ad_id" | "ebay_promotion_id" | "marketing_error">
>;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Post-publish marketing for one live listing. Each step persists the id
 * eBay returns the moment it has it, and is skipped when that id is already
 * stored — so running this twice (the apply-marketing retry) can never
 * create a duplicate ad or promotion. The two steps are independent: one
 * failing never skips the other. Never throws — the listing is already
 * live, and every failure comes back as a warning string.
 */
export async function runMarketingSteps(
  draft: EbayListingDraft,
  listingId: string,
  api: MarketingApi,
  persist: (patch: MarketingPatch) => Promise<void>
): Promise<string[]> {
  const warnings: string[] = [];

  if (draft.ad_rate != null && !draft.ebay_ad_id) {
    try {
      let campaignId = draft.ad_campaign_id;
      if (!campaignId) {
        campaignId = await api.createCampaign(draft.ad_rate);
        // Saved before the ad call: if that call fails, the retry reuses this
        // campaign instead of creating a second one.
        await persist({ ad_campaign_id: campaignId });
      }
      const adId = await api.addListingToCampaign(campaignId, listingId, draft.ad_rate);
      await persist({ ebay_ad_id: adId });
    } catch (err) {
      warnings.push(`The ad couldn't be added: ${messageOf(err)}`);
    }
  }

  const tiers = multiBuyTiersFromDraft(draft);
  if (tiers && !draft.ebay_promotion_id) {
    try {
      const promotionId = await api.createVolumeDiscount(listingId, tiers);
      await persist({ ebay_promotion_id: promotionId });
    } catch (err) {
      warnings.push(`The multi-buy discount couldn't be created: ${messageOf(err)}`);
    }
  }

  const nextError = warnings.length > 0 ? warnings.join(" ") : null;
  if (nextError !== draft.marketing_error) {
    try {
      await persist({ marketing_error: nextError });
    } catch (err) {
      console.error("[ebay/marketing] could not save marketing_error:", messageOf(err));
    }
  }

  return warnings;
}

/** Route-side wrapper: runs the steps against eBay and returns the fresh row. */
export async function applyMarketingToDraft(
  client: IntegrationAuthContext["client"],
  draft: EbayListingDraft,
  accessToken: string
): Promise<{ draft: EbayListingDraft; warnings: string[] }> {
  if (!draft.ebay_listing_id) return { draft, warnings: [] };

  const persist = async (patch: MarketingPatch) => {
    const { error } = await client.from("ebay_listing_drafts").update(patch).eq("id", draft.id);
    if (error) throw new Error("Could not save eBay's response to this listing.");
  };

  const warnings = await runMarketingSteps(
    draft,
    draft.ebay_listing_id,
    createMarketingApi(accessToken),
    persist
  );

  const { data } = await client
    .from("ebay_listing_drafts")
    .select("*")
    .eq("id", draft.id)
    .single<EbayListingDraft>();

  return { draft: data ?? draft, warnings };
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `npx jest src/lib/integrations/ebay/marketing.test.ts src/lib/integrations/ebay/publishPayloads.test.ts`
Expected: PASS

- [ ] **Step 10: Add the OAuth scope**

In `src/lib/integrations/ebay.ts`, replace the `EBAY_SCOPE` block and extend its comment:

```ts
// sell.inventory (full, not .readonly) is required for Trading API calls
// (GetMyeBaySelling in listings.ts). sell.account is required for the
// Business Policies endpoints (fetchBusinessPolicies in publish.ts —
// /sell/account/v1/{fulfillment,payment,return}_policy), which 403 with
// errorId 1100 ("Insufficient permissions") without it. sell.marketing
// (2026-09-11) is required for Promoted Listings campaigns/ads and
// multi-buy item promotions (ebay/marketing.ts). Connections
// authorised before any scope was added must be disconnected and
// reconnected — a code deploy alone does not retroactively grant scopes to
// an already-issued token/refresh-token pair.
const EBAY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment" +
  " https://api.ebay.com/oauth/api_scope/sell.inventory" +
  " https://api.ebay.com/oauth/api_scope/sell.account" +
  " https://api.ebay.com/oauth/api_scope/sell.marketing";
```

Run: `npx jest src/lib/integrations/ebay.test.ts`
Expected: PASS. If a test asserts the exact scope string, update that expected string to include ` https://api.ebay.com/oauth/api_scope/sell.marketing`.

- [ ] **Step 11: Document in `src/lib/integrations/SKILL.md`**

Insert a new section immediately before `## Merge rule (re-import field ownership)`:

```markdown
## eBay marketing (Promoted Listings + multi-buy, 2026-09-11)

`ebay/marketing.ts` wraps the Marketing API for the listing form:
`fetchManualCampaigns` (running/scheduled cost-per-sale campaigns on
`MARKETPLACE_ID`, rules-based ones filtered out — eBay rejects hand-added
ads on those), and `runMarketingSteps` → `createCampaign` (only when the
draft has no `ad_campaign_id`) → `addListingToCampaign` →
`createVolumeDiscount`. All create calls read the new id from the 201's
`Location` header (`idFromLocation`).

- **Scope**: needs `sell.marketing`, added to `EBAY_SCOPE` on 2026-09-11.
  Existing connections must disconnect + reconnect once. We don't store
  granted scopes, so **a 403 from the Marketing API is the detection
  signal**: `fetchManualCampaigns` returns `needsReconnect: true`, and the
  create calls throw `RECONNECT_MESSAGE`.
- **Idempotency**: each step persists its id (`ad_campaign_id`,
  `ebay_ad_id`, `ebay_promotion_id`) immediately and is skipped when the id
  is already stored, so `POST /api/listings/[id]/apply-marketing` can be
  retried safely. `runMarketingSteps` never throws — the listing is live by
  then; failures become warning strings stored in `marketing_error`.
- `ebayFetch`/`throwIfNotOk`/`MARKETPLACE_ID` are exported from
  `ebay/publish.ts` for this module — reuse them, don't copy them.
```

- [ ] **Step 12: Commit**

```bash
git add src/lib/integrations/ebay/publishPayloads.ts src/lib/integrations/ebay/publishPayloads.test.ts src/lib/integrations/ebay/publish.ts src/lib/integrations/ebay/marketing.ts src/lib/integrations/ebay/marketing.test.ts src/lib/integrations/ebay.ts src/lib/integrations/ebay.test.ts src/lib/integrations/SKILL.md
git commit -m "feat(ebay): Marketing API module for campaigns, ads and multi-buy

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(Drop `src/lib/integrations/ebay.test.ts` from `git add` if Step 10 didn't change it.)

---

### Task 4: Campaigns route, publish integration, apply-marketing route

**Files:**
- Create: `src/app/api/listings/ebay/campaigns/route.ts`
- Modify: `src/app/api/listings/[id]/publish/route.ts`
- Create: `src/app/api/listings/[id]/apply-marketing/route.ts`
- Modify: `src/app/dashboard/listings/_components/ListingForm.tsx` (`handlePublish` only — response shape changed)
- Modify: `src/app/dashboard/listings/CLAUDE.md`, `src/app/dashboard/listings/SKILL.md`

**Interfaces:**
- Consumes: `fetchManualCampaigns`, `applyMarketingToDraft` (Task 3).
- Produces:
  - `GET /api/listings/ebay/campaigns` → `200 { campaigns: {id, name}[]; needsReconnect: boolean }` | `400/500/502 { error }`
  - `POST /api/listings/[id]/publish` → `200 { draft: EbayListingDraft; warnings: string[] }` (was: the bare draft) | unchanged error shapes
  - `POST /api/listings/[id]/apply-marketing` → `200 { draft, warnings }` | `403/404/409/400/500 { error }`

Route handlers aren't unit-tested in this repo (they're thin: guard → Supabase → lib). The logic they call is covered by Task 3's tests.

- [ ] **Step 1: Create the campaigns route**

`src/app/api/listings/ebay/campaigns/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { fetchManualCampaigns } from "@/lib/integrations/ebay/marketing";

export async function GET() {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  const conn = await getConnection(client, "ebay");
  if (!conn || conn.status !== "connected") {
    return NextResponse.json(
      { error: "eBay is not connected. Connect it in Integrations first." },
      { status: 400 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await ensureValidAccessToken(client, conn, ebayAdapter);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to refresh eBay token";
    console.error("[listings/ebay/campaigns] token refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    // A missing sell.marketing scope comes back as needsReconnect: true with
    // a 200 — it's an expected state the form renders, not an error.
    return NextResponse.json(await fetchManualCampaigns(accessToken));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch campaigns";
    console.error("[listings/ebay/campaigns] fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Run marketing after publish**

In `src/app/api/listings/[id]/publish/route.ts`:

Add the import:

```ts
import { applyMarketingToDraft } from "@/lib/integrations/ebay/marketing";
```

Replace everything from `  try {\n    const result = await publishListing(` to the end of the file with:

```ts
  let published: EbayListingDraft;
  try {
    const result = await publishListing(
      accessToken,
      draft,
      sku,
      draft.ebay_offer_id,
      async (offerId) => {
        await client.from("ebay_listing_drafts").update({ ebay_offer_id: offerId }).eq("id", id);
      }
    );

    const { data: updated, error: updateError } = await client
      .from("ebay_listing_drafts")
      .update({
        status: "published",
        ebay_sku: sku,
        ebay_offer_id: result.offerId,
        ebay_listing_id: result.listingId,
        publish_error: null,
      })
      .eq("id", id)
      .select()
      .single<EbayListingDraft>();

    if (updateError) throw updateError;
    published = updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publish failed";
    console.error("[listings/publish] failed:", message);

    // Best-effort: persist whatever offerId was captured before the failure
    // (publishListing throws after createOffer but before publishOffer, for
    // example) so a retry resumes with updateOffer instead of createOffer.
    const { data: failed } = await client
      .from("ebay_listing_drafts")
      .update({ status: "failed", ebay_sku: sku, publish_error: message })
      .eq("id", id)
      .select()
      .single<EbayListingDraft>();

    return NextResponse.json(
      { error: message, draft: failed ?? null },
      { status: 502 }
    );
  }

  // The listing is live from here on. Ads and multi-buy are optional extras:
  // nothing below may mark the draft failed or answer with an error status —
  // failures come back as warnings (and in marketing_error) for the form's
  // toast and the live page's Retry banner.
  const { draft: finalDraft, warnings } = await applyMarketingToDraft(
    client,
    published,
    accessToken
  );
  return NextResponse.json({ draft: finalDraft, warnings });
}
```

- [ ] **Step 3: Create the apply-marketing route**

`src/app/api/listings/[id]/apply-marketing/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { hasPermission } from "@/lib/utils/permissions";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { applyMarketingToDraft } from "@/lib/integrations/ebay/marketing";
import type { EbayListingDraft, Profile } from "@/types";

// Re-runs only the post-publish marketing steps (ad + multi-buy) for a live
// listing. Safe to call repeatedly: runMarketingSteps skips any step whose
// eBay id is already stored on the draft.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId } = auth.context;

  const { data: profile } = await client
    .from("profiles")
    .select("role, permission_overrides")
    .eq("id", userId)
    .single<Pick<Profile, "role" | "permission_overrides">>();
  if (!profile?.role || !hasPermission(profile.role, "manage_listings", profile.permission_overrides)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { data: draft, error: fetchError } = await client
    .from("ebay_listing_drafts")
    .select("*")
    .eq("id", id)
    .single<EbayListingDraft>();
  if (fetchError || !draft) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  if (draft.status !== "published" || !draft.ebay_listing_id) {
    return NextResponse.json(
      { error: "Only live listings can have advertising or discounts applied." },
      { status: 409 }
    );
  }

  const conn = await getConnection(client, "ebay");
  if (!conn || conn.status !== "connected") {
    return NextResponse.json(
      { error: "eBay is not connected. Connect it in Integrations first." },
      { status: 400 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await ensureValidAccessToken(client, conn, ebayAdapter);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to refresh eBay token";
    console.error("[listings/apply-marketing] token refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json(await applyMarketingToDraft(client, draft, accessToken));
}
```

- [ ] **Step 4: Adapt the form to the new publish response**

In `src/app/dashboard/listings/_components/ListingForm.tsx`:

Change `const { success, error: toastError } = useToast();` to:

```ts
  const { success, warning, error: toastError } = useToast();
```

In `handlePublish`, replace:

```ts
      dispatch(updateListingDraft(json));
      success("Published to eBay.");
      router.push("/dashboard/listings");
```

with:

```ts
      dispatch(updateListingDraft(json.draft));
      const warnings: string[] = json.warnings ?? [];
      if (warnings.length > 0) {
        // The listing IS live — only the optional ad/multi-buy extras failed.
        warning(
          "Published to eBay, but not everything was applied.",
          `${warnings.join(" ")} You can retry from the listing's edit page.`
        );
      } else {
        success("Published to eBay.");
      }
      router.push("/dashboard/listings");
```

- [ ] **Step 5: Update docs**

In `src/app/dashboard/listings/CLAUDE.md`, append to `## Publish flow` (after the Task 2 paragraph):

```markdown

**Post-publish marketing (2026-09-11).** Once `publishOffer` has succeeded
and the row is `published`, the route calls `applyMarketingToDraft`
(`lib/integrations/ebay/marketing.ts`): add the listing to its campaign
(creating one first when `ad_campaign_id` is null) and create the multi-buy
volume promotion. These run **outside** the publish try/catch on purpose —
a marketing failure never marks the draft `failed`; it returns
`200 { draft, warnings }` and stores the text in `marketing_error`. The
form shows a warning toast instead of the success toast.
`POST /api/listings/[id]/apply-marketing` re-runs only these steps for a
published row (409 otherwise) — each step is skipped when its id
(`ebay_ad_id`/`ebay_promotion_id`) is already stored, so retries never
duplicate. `GET /api/listings/ebay/campaigns` feeds the Advertising
section: `{ campaigns, needsReconnect }`, where `needsReconnect` is a 403
from eBay (missing `sell.marketing` scope), returned as a 200.
```

In `src/app/dashboard/listings/SKILL.md`, under `## Gotchas`, add as the first bullet:

```markdown
- **The publish route answers `{ draft, warnings }`, not the bare draft
  (2026-09-11).** Anything dispatching its response must use `json.draft`.
  `warnings` non-empty means the listing is live but the ad and/or
  multi-buy failed — never treat that as a failed publish, and never move
  marketing calls inside the publish try/catch (that would mark a live
  listing `failed` and invite a duplicate publish on retry).
```

- [ ] **Step 6: Run the listings + integration tests**

Run: `npx jest src/app/dashboard/listings src/lib/integrations/ebay`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/api/listings/ebay/campaigns/route.ts "src/app/api/listings/[id]/publish/route.ts" "src/app/api/listings/[id]/apply-marketing/route.ts" src/app/dashboard/listings/_components/ListingForm.tsx src/app/dashboard/listings/CLAUDE.md src/app/dashboard/listings/SKILL.md
git commit -m "feat(listings): apply ads and multi-buy after publish, with a retry route

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Optional item specifics from the Taxonomy API (server)

**Files:**
- Create: `src/lib/integrations/ebay/aspects.ts`
- Test: `src/lib/integrations/ebay/aspects.test.ts`
- Modify: `src/lib/integrations/ebay/publish.ts` (Taxonomy aspects section, ~lines 137–202)
- Modify: `src/app/api/listings/ebay/aspects/route.ts`
- Modify: `src/app/dashboard/listings/CLAUDE.md`, `src/app/dashboard/listings/SKILL.md` (rename `fetchRequiredAspects` mentions)

**Interfaces:**
- Produces (in `aspects.ts`):
  - `interface TaxonomyAspect { localizedAspectName: string; aspectConstraint?: { aspectRequired?: boolean; aspectUsage?: string; aspectMode?: string }; aspectValues?: { localizedValue: string }[] }`
  - `interface RequiredAspect { name: string; values: string[]; isProductIdentifier: boolean }`
  - `interface OptionalAspect { name: string; values: string[]; mode: "SELECTION_ONLY" | "FREE_TEXT"; recommended: boolean }`
  - `splitCategoryAspects(aspects: TaxonomyAspect[]): { required: RequiredAspect[]; optional: OptionalAspect[] }`
- Produces (in `publish.ts`): `fetchCategoryAspects(categoryId: string): Promise<{ required: RequiredAspect[]; optional: OptionalAspect[] }>`; `fetchRequiredAspects` is **removed** (its only caller is the aspects route).
- Produces (route): `GET /api/listings/ebay/aspects?categoryId=` → `{ aspects: RequiredAspect[]; optionalAspects: OptionalAspect[]; notApplicableText: string }`

- [ ] **Step 1: Write the failing test**

`src/lib/integrations/ebay/aspects.test.ts`:

```ts
import { splitCategoryAspects, type TaxonomyAspect } from "./aspects";

function aspect(
  name: string,
  constraint: TaxonomyAspect["aspectConstraint"] = {},
  values: string[] = []
): TaxonomyAspect {
  return {
    localizedAspectName: name,
    aspectConstraint: constraint,
    aspectValues: values.map((localizedValue) => ({ localizedValue })),
  };
}

describe("splitCategoryAspects", () => {
  it("puts aspectRequired aspects in required, with their values", () => {
    const { required, optional } = splitCategoryAspects([
      aspect("Marke", { aspectRequired: true, aspectUsage: "RECOMMENDED" }, ["Unbranded"]),
    ]);
    expect(required).toEqual([{ name: "Marke", values: ["Unbranded"], isProductIdentifier: false }]);
    expect(optional).toEqual([]);
  });

  it("treats product identifiers as required even when eBay says RECOMMENDED", () => {
    const { required, optional } = splitCategoryAspects([
      aspect("EAN", { aspectUsage: "RECOMMENDED" }),
    ]);
    expect(required).toEqual([{ name: "EAN", values: [], isProductIdentifier: true }]);
    expect(optional).toEqual([]);
  });

  it("lists recommended optional aspects before plain optional ones, keeping eBay's order", () => {
    const { optional } = splitCategoryAspects([
      aspect("Material", { aspectUsage: "OPTIONAL" }),
      aspect("Farbe", { aspectUsage: "RECOMMENDED", aspectMode: "SELECTION_ONLY" }, ["Schwarz"]),
      aspect("Stil", { aspectUsage: "OPTIONAL" }),
      aspect("Abteilung", { aspectUsage: "RECOMMENDED" }, ["Herren", "Unisex"]),
    ]);
    expect(optional.map((a) => a.name)).toEqual(["Farbe", "Abteilung", "Material", "Stil"]);
    expect(optional[0]).toEqual({
      name: "Farbe",
      values: ["Schwarz"],
      mode: "SELECTION_ONLY",
      recommended: true,
    });
  });

  it("defaults a missing aspectMode to FREE_TEXT", () => {
    const { optional } = splitCategoryAspects([aspect("Stil", { aspectUsage: "OPTIONAL" })]);
    expect(optional[0].mode).toBe("FREE_TEXT");
    expect(optional[0].recommended).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/lib/integrations/ebay/aspects.test.ts`
Expected: FAIL — `Cannot find module './aspects'`.

- [ ] **Step 3: Implement `aspects.ts`**

Create `src/lib/integrations/ebay/aspects.ts` — move the product-identifier constant and its comment here from `publish.ts` verbatim:

```ts
// Pure classification of eBay Taxonomy API item aspects. No I/O — the fetch
// lives in publish.ts (fetchCategoryAspects).

export interface TaxonomyAspect {
  localizedAspectName: string;
  aspectConstraint?: { aspectRequired?: boolean; aspectUsage?: string; aspectMode?: string };
  aspectValues?: { localizedValue: string }[];
}

export interface RequiredAspect {
  name: string;
  values: string[];
  isProductIdentifier: boolean;
}

export interface OptionalAspect {
  name: string;
  values: string[];
  mode: "SELECTION_ONLY" | "FREE_TEXT";
  /** eBay marks it RECOMMENDED — buyers filter by it; shown first. */
  recommended: boolean;
}

// Product identifiers (GTIN family: EAN/UPC/ISBN, plus MPN) are a
// documented eBay concept distinct from ordinary category aspects — many
// categories require at least one of them (a GTIN, OR a Brand+MPN pair),
// per eBay's own publishing-offers docs. The trap: eBay's Taxonomy API
// commonly reports these as aspectUsage "RECOMMENDED" rather than
// aspectRequired: true, even when publishOffer treats them as mandatory —
// confirmed live 2026-08-31: "Brand" was correctly caught by
// `aspectRequired === true`, but "EAN" was NOT, and still made
// publishOffer 400 with errorId 25002 once Brand was fixed. Recognizing
// this named, finite set by name (rather than loosening the required-filter
// to "anything not explicitly OPTIONAL", which would flood every category's
// step with cosmetic aspects like Color/Style/Material) closes this whole
// class of failure going forward, not just for EAN.
const PRODUCT_IDENTIFIER_NAMES = new Set(["ean", "upc", "isbn", "gtin", "mpn"]);

export function isProductIdentifierAspect(name: string): boolean {
  return PRODUCT_IDENTIFIER_NAMES.has(name.trim().toLowerCase());
}

export function splitCategoryAspects(aspects: TaxonomyAspect[]): {
  required: RequiredAspect[];
  optional: OptionalAspect[];
} {
  const required: RequiredAspect[] = [];
  const recommended: OptionalAspect[] = [];
  const rest: OptionalAspect[] = [];

  for (const a of aspects) {
    const name = a.localizedAspectName;
    const values = (a.aspectValues ?? []).map((v) => v.localizedValue);
    const isProductIdentifier = isProductIdentifierAspect(name);

    if (a.aspectConstraint?.aspectRequired === true || isProductIdentifier) {
      required.push({ name, values, isProductIdentifier });
      continue;
    }

    const isRecommended = a.aspectConstraint?.aspectUsage === "RECOMMENDED";
    const entry: OptionalAspect = {
      name,
      values,
      mode: a.aspectConstraint?.aspectMode === "SELECTION_ONLY" ? "SELECTION_ONLY" : "FREE_TEXT",
      recommended: isRecommended,
    };
    (isRecommended ? recommended : rest).push(entry);
  }

  return { required, optional: [...recommended, ...rest] };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/lib/integrations/ebay/aspects.test.ts`
Expected: PASS

- [ ] **Step 5: Replace `fetchRequiredAspects` in `publish.ts`**

In `src/lib/integrations/ebay/publish.ts`, delete everything from `export interface RequiredAspect {` through the end of `fetchRequiredAspects` (the `TaxonomyAspectValue`/`TaxonomyAspect`/`TaxonomyAspectsResponse` interfaces, `PRODUCT_IDENTIFIER_NAMES` + its comment, `isProductIdentifierAspect`, and `fetchRequiredAspects`), and put in its place:

```ts
interface TaxonomyAspectsResponse {
  aspects?: TaxonomyAspect[];
}

export type { RequiredAspect, OptionalAspect } from "./aspects";

// Which item aspects (e.g. Brand — "Marke" on EBAY_DE, per the localized
// Content-Language this app sends) a category requires varies per category
// and is only knowable by asking eBay — publishOffer rejects with errorId
// 25002 one missing aspect at a time otherwise, discovered live 2026-08-31
// on "Vitamine & Mineralien" requiring Brand, then EAN. The same response
// also carries the category's optional/recommended aspects, which the form
// offers in its collapsible "Other item specifics" group (2026-09-11).
// Same application-token rationale as searchCategories: category metadata
// isn't seller-specific.
export async function fetchCategoryAspects(
  categoryId: string
): Promise<ReturnType<typeof splitCategoryAspects>> {
  const accessToken = await getApplicationToken();
  const params = new URLSearchParams({ category_id: categoryId });
  const res = await ebayFetch(
    `/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_item_aspects_for_category?${params.toString()}`,
    accessToken
  );
  await throwIfNotOk(res, "getItemAspectsForCategory");

  const json = (await res.json()) as TaxonomyAspectsResponse;
  return splitCategoryAspects(json.aspects ?? []);
}
```

and add at the top of the file:

```ts
import { splitCategoryAspects, type TaxonomyAspect } from "./aspects";
```

- [ ] **Step 6: Return optional aspects from the route**

In `src/app/api/listings/ebay/aspects/route.ts`, change the import to:

```ts
import {
  fetchCategoryAspects,
  getProductIdentifierNotApplicableText,
} from "@/lib/integrations/ebay/publish";
```

and the `try` body to:

```ts
    const { required, optional } = await fetchCategoryAspects(categoryId);
    return NextResponse.json({
      aspects: required,
      optionalAspects: optional,
      notApplicableText: getProductIdentifierNotApplicableText(),
    });
```

(`aspects` keeps its name so `AspectsStep`'s existing required-field code and `validateAspectsStep` are untouched.)

- [ ] **Step 7: Update doc references**

In `src/app/dashboard/listings/CLAUDE.md` and `SKILL.md`, replace each `fetchRequiredAspects` mention with `fetchCategoryAspects`. In the SKILL.md bullet that describes the product-identifier fix (search "`fetchRequiredAspects` now also"), append: "The classification now lives in the pure `lib/integrations/ebay/aspects.ts` (`splitCategoryAspects`, tested); `fetchCategoryAspects` returns `{ required, optional }` and the aspects route exposes `optional` as `optionalAspects` (2026-09-11)."

- [ ] **Step 8: Run tests**

Run: `npx jest src/lib/integrations/ebay`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/integrations/ebay/aspects.ts src/lib/integrations/ebay/aspects.test.ts src/lib/integrations/ebay/publish.ts src/app/api/listings/ebay/aspects/route.ts src/app/dashboard/listings/CLAUDE.md src/app/dashboard/listings/SKILL.md
git commit -m "feat(listings): return optional item specifics from the aspects route

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Form state, validators and DB mapping

**Files:**
- Modify: `src/app/dashboard/listings/_lib/wizardValidation.ts`
- Test: `src/app/dashboard/listings/_lib/wizardValidation.test.ts`
- Modify: `src/app/dashboard/listings/_lib/listingQuality.test.ts` (fixture)
- Modify: `src/app/dashboard/listings/_components/ListingForm.tsx` (`EMPTY_DRAFT`, `toFormState`, `toPayload`, `publishError`)
- Modify: `src/app/dashboard/listings/SKILL.md`

**Interfaces:**
- Consumes: `EbayListingDraft` fields (Task 1).
- Produces (in `wizardValidation.ts`):
  - `DraftFormState` gains `vat_percentage: string; best_offer_enabled: boolean; best_offer_auto_accept: string; best_offer_auto_decline: string; multibuy_enabled: boolean; multibuy_2_pct: string; multibuy_3_pct: string; multibuy_4_pct: string; ad_enabled: boolean; ad_rate: string; ad_campaign_id: string;`
  - `NEW_CAMPAIGN = "__new__"` (form sentinel for "create a campaign automatically"; `""` = not chosen yet)
  - `EMPTY_PRICING_MARKETING: Pick<DraftFormState, …those 11 keys…>`
  - `MIN_AD_RATE = 2`, `MAX_AD_RATE = 100`, `MULTIBUY_MAX_PCT = 80`, `MULTIBUY_PERCENT_OPTIONS: number[]` (1…80)
  - `validatePricingStep(draft): string | null`, `validateAdvertisingStep(draft): string | null`

- [ ] **Step 1: Write the failing validator tests**

In `src/app/dashboard/listings/_lib/wizardValidation.test.ts`: add `validatePricingStep, validateAdvertisingStep, EMPTY_PRICING_MARKETING, NEW_CAMPAIGN` to the import, add `...EMPTY_PRICING_MARKETING,` as the first line inside `makeDraft`'s returned object (before `source_type`), then append:

```ts
describe("validatePricingStep", () => {
  it("passes with nothing extra set", () => {
    expect(validatePricingStep(makeDraft())).toBeNull();
  });

  it("accepts VAT from 0 to 100 and rejects values outside it", () => {
    expect(validatePricingStep(makeDraft({ vat_percentage: "0" }))).toBeNull();
    expect(validatePricingStep(makeDraft({ vat_percentage: "19" }))).toBeNull();
    expect(validatePricingStep(makeDraft({ vat_percentage: "101" }))).toBe(
      "VAT must be between 0 and 100%."
    );
    expect(validatePricingStep(makeDraft({ vat_percentage: "-1" }))).toBe(
      "VAT must be between 0 and 100%."
    );
  });

  it("allows Best Offer with no thresholds", () => {
    expect(validatePricingStep(makeDraft({ best_offer_enabled: true }))).toBeNull();
  });

  it("requires Best Offer thresholds to sit below the price", () => {
    expect(
      validatePricingStep(makeDraft({ best_offer_enabled: true, best_offer_auto_accept: "19.99" }))
    ).toBe("Auto-accept price must be above 0 and below the listing price.");
    expect(
      validatePricingStep(makeDraft({ best_offer_enabled: true, best_offer_auto_decline: "25" }))
    ).toBe("Auto-decline price must be above 0 and below the listing price.");
  });

  it("requires auto-decline below auto-accept", () => {
    expect(
      validatePricingStep(
        makeDraft({
          best_offer_enabled: true,
          best_offer_auto_accept: "15",
          best_offer_auto_decline: "15",
        })
      )
    ).toBe("Auto-decline price must be below the auto-accept price.");
  });

  it("ignores Best Offer thresholds while Best Offer is off", () => {
    expect(
      validatePricingStep(makeDraft({ best_offer_enabled: false, best_offer_auto_accept: "999" }))
    ).toBeNull();
  });

  it("requires a Buy 2 tier once multi-buy is on", () => {
    expect(validatePricingStep(makeDraft({ multibuy_enabled: true }))).toBe(
      "Choose a Buy 2 discount."
    );
  });

  it("requires tiers to increase", () => {
    expect(
      validatePricingStep(
        makeDraft({ multibuy_enabled: true, multibuy_2_pct: "5", multibuy_3_pct: "5" })
      )
    ).toBe("The Buy 3 discount must be higher than Buy 2.");
    expect(
      validatePricingStep(
        makeDraft({
          multibuy_enabled: true,
          multibuy_2_pct: "2",
          multibuy_3_pct: "4",
          multibuy_4_pct: "3",
        })
      )
    ).toBe("The Buy 4+ discount must be higher than Buy 3.");
  });

  it("requires Buy 3 before Buy 4+", () => {
    expect(
      validatePricingStep(
        makeDraft({ multibuy_enabled: true, multibuy_2_pct: "2", multibuy_4_pct: "15" })
      )
    ).toBe("Set a Buy 3 discount before Buy 4 or more.");
  });

  it("accepts the screenshot's 2% / 4% / 15% tiers", () => {
    expect(
      validatePricingStep(
        makeDraft({
          multibuy_enabled: true,
          multibuy_2_pct: "2",
          multibuy_3_pct: "4",
          multibuy_4_pct: "15",
        })
      )
    ).toBeNull();
  });
});

describe("validateAdvertisingStep", () => {
  it("passes when the ad is off, whatever the other fields hold", () => {
    expect(validateAdvertisingStep(makeDraft({ ad_enabled: false, ad_rate: "500" }))).toBeNull();
  });

  it("accepts a rate from 2 to 100 with at most one decimal", () => {
    for (const rate of ["2", "13", "16.3", "100"]) {
      expect(
        validateAdvertisingStep(makeDraft({ ad_enabled: true, ad_rate: rate, ad_campaign_id: "c-1" }))
      ).toBeNull();
    }
  });

  it("rejects an out-of-range or over-precise rate", () => {
    for (const rate of ["", "1.9", "100.1", "abc"]) {
      expect(
        validateAdvertisingStep(makeDraft({ ad_enabled: true, ad_rate: rate, ad_campaign_id: "c-1" }))
      ).toBe("Ad rate must be between 2 and 100%.");
    }
    expect(
      validateAdvertisingStep(makeDraft({ ad_enabled: true, ad_rate: "13.25", ad_campaign_id: "c-1" }))
    ).toBe("Ad rate can have at most one decimal place.");
  });

  it("requires a campaign choice, where auto-create counts as one", () => {
    expect(validateAdvertisingStep(makeDraft({ ad_enabled: true, ad_rate: "13" }))).toBe(
      "Choose a campaign for the ad."
    );
    expect(
      validateAdvertisingStep(
        makeDraft({ ad_enabled: true, ad_rate: "13", ad_campaign_id: NEW_CAMPAIGN })
      )
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/app/dashboard/listings/_lib/wizardValidation.test.ts`
Expected: FAIL — imports undefined.

- [ ] **Step 3: Implement in `wizardValidation.ts`**

Add these fields to the end of `interface DraftFormState` (after `merchant_location_key: string;`):

```ts
  /** "" = VAT not sent. */
  vat_percentage: string;
  best_offer_enabled: boolean;
  best_offer_auto_accept: string;
  best_offer_auto_decline: string;
  multibuy_enabled: boolean;
  multibuy_2_pct: string;
  multibuy_3_pct: string;
  multibuy_4_pct: string;
  ad_enabled: boolean;
  ad_rate: string;
  /** A campaign id, NEW_CAMPAIGN (create one at publish), or "" (not chosen yet). */
  ad_campaign_id: string;
```

Append to the file:

```ts
/** Form sentinel for "Create a new campaign automatically" — saved as null. */
export const NEW_CAMPAIGN = "__new__";

export const EMPTY_PRICING_MARKETING = {
  vat_percentage: "",
  best_offer_enabled: false,
  best_offer_auto_accept: "",
  best_offer_auto_decline: "",
  multibuy_enabled: false,
  multibuy_2_pct: "",
  multibuy_3_pct: "",
  multibuy_4_pct: "",
  ad_enabled: false,
  ad_rate: "",
  ad_campaign_id: "",
} satisfies Partial<DraftFormState>;

export const MIN_AD_RATE = 2;
export const MAX_AD_RATE = 100;
export const MULTIBUY_MAX_PCT = 80;
export const MULTIBUY_PERCENT_OPTIONS = Array.from({ length: MULTIBUY_MAX_PCT }, (_, i) => i + 1);

/** Blank → null; anything else → Number (NaN for junk, caught by callers). */
function optionalNumber(value: string): number | null {
  return value.trim() ? Number(value) : null;
}

export function validatePricingStep(draft: DraftFormState): string | null {
  const vat = optionalNumber(draft.vat_percentage);
  if (vat !== null && (!Number.isFinite(vat) || vat < 0 || vat > 100)) {
    return "VAT must be between 0 and 100%.";
  }

  if (draft.best_offer_enabled) {
    const price = Number(draft.price);
    const accept = optionalNumber(draft.best_offer_auto_accept);
    const decline = optionalNumber(draft.best_offer_auto_decline);
    if (accept !== null && (!Number.isFinite(accept) || accept <= 0 || accept >= price)) {
      return "Auto-accept price must be above 0 and below the listing price.";
    }
    if (decline !== null && (!Number.isFinite(decline) || decline <= 0 || decline >= price)) {
      return "Auto-decline price must be above 0 and below the listing price.";
    }
    if (accept !== null && decline !== null && decline >= accept) {
      return "Auto-decline price must be below the auto-accept price.";
    }
  }

  if (draft.multibuy_enabled) {
    const buy2 = optionalNumber(draft.multibuy_2_pct);
    const buy3 = optionalNumber(draft.multibuy_3_pct);
    const buy4 = optionalNumber(draft.multibuy_4_pct);
    if (buy2 === null) return "Choose a Buy 2 discount.";
    if (buy4 !== null && buy3 === null) return "Set a Buy 3 discount before Buy 4 or more.";
    if (buy3 !== null && buy3 <= buy2) return "The Buy 3 discount must be higher than Buy 2.";
    if (buy4 !== null && buy3 !== null && buy4 <= buy3) {
      return "The Buy 4+ discount must be higher than Buy 3.";
    }
  }

  return null;
}

export function validateAdvertisingStep(draft: DraftFormState): string | null {
  if (!draft.ad_enabled) return null;
  const rate = optionalNumber(draft.ad_rate);
  if (rate === null || !Number.isFinite(rate) || rate < MIN_AD_RATE || rate > MAX_AD_RATE) {
    return `Ad rate must be between ${MIN_AD_RATE} and ${MAX_AD_RATE}%.`;
  }
  // String check, not float maths: 13.25 * 10 isn't reliably non-integer.
  if (!/^\d+(\.\d)?$/.test(draft.ad_rate.trim())) {
    return "Ad rate can have at most one decimal place.";
  }
  if (!draft.ad_campaign_id) return "Choose a campaign for the ad.";
  return null;
}
```

- [ ] **Step 4: Fix the `listingQuality` fixture**

In `src/app/dashboard/listings/_lib/listingQuality.test.ts`, change the import to also bring `EMPTY_PRICING_MARKETING`:

```ts
import { EMPTY_PRICING_MARKETING, type DraftFormState } from "./wizardValidation";
```

and add `...EMPTY_PRICING_MARKETING,` as the first line inside `emptyDraft`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/app/dashboard/listings/_lib`
Expected: PASS

- [ ] **Step 6: Map the fields in `ListingForm.tsx`**

Extend the `../_lib/wizardValidation` import with `validatePricingStep, validateAdvertisingStep, EMPTY_PRICING_MARKETING, NEW_CAMPAIGN`.

In `EMPTY_DRAFT`, add `...EMPTY_PRICING_MARKETING,` as the last line (after `merchant_location_key: "",`).

In `toFormState`, add after `merchant_location_key: row.merchant_location_key ?? "",`:

```ts
    vat_percentage: row.vat_percentage != null ? String(row.vat_percentage) : "",
    best_offer_enabled: row.best_offer_enabled,
    best_offer_auto_accept:
      row.best_offer_auto_accept != null ? String(row.best_offer_auto_accept) : "",
    best_offer_auto_decline:
      row.best_offer_auto_decline != null ? String(row.best_offer_auto_decline) : "",
    multibuy_enabled: row.multibuy_2_pct != null,
    multibuy_2_pct: row.multibuy_2_pct != null ? String(row.multibuy_2_pct) : "",
    multibuy_3_pct: row.multibuy_3_pct != null ? String(row.multibuy_3_pct) : "",
    multibuy_4_pct: row.multibuy_4_pct != null ? String(row.multibuy_4_pct) : "",
    ad_enabled: row.ad_rate != null,
    ad_rate: row.ad_rate != null ? String(row.ad_rate) : "",
    // A saved ad with no campaign means "create one at publish".
    ad_campaign_id: row.ad_rate != null ? (row.ad_campaign_id ?? NEW_CAMPAIGN) : "",
```

Add, directly above `function ListingForm` (below `toFormState`):

```ts
/** "" → null, otherwise Number. Used for the optional numeric draft columns. */
function numberOrNull(value: string): number | null {
  return value.trim() ? Number(value) : null;
}
```

In `toPayload()`, add after `merchant_location_key: draft.merchant_location_key || null,`:

```ts
      vat_percentage: numberOrNull(draft.vat_percentage),
      best_offer_enabled: draft.best_offer_enabled,
      // Switched-off extras are saved as null, so a stale value can never
      // reach eBay (or trip a DB CHECK) from a hidden field.
      best_offer_auto_accept: draft.best_offer_enabled
        ? numberOrNull(draft.best_offer_auto_accept)
        : null,
      best_offer_auto_decline: draft.best_offer_enabled
        ? numberOrNull(draft.best_offer_auto_decline)
        : null,
      multibuy_2_pct: draft.multibuy_enabled ? numberOrNull(draft.multibuy_2_pct) : null,
      multibuy_3_pct: draft.multibuy_enabled ? numberOrNull(draft.multibuy_3_pct) : null,
      multibuy_4_pct: draft.multibuy_enabled ? numberOrNull(draft.multibuy_4_pct) : null,
      ad_rate: draft.ad_enabled ? numberOrNull(draft.ad_rate) : null,
      ad_campaign_id:
        draft.ad_enabled && draft.ad_campaign_id && draft.ad_campaign_id !== NEW_CAMPAIGN
          ? draft.ad_campaign_id
          : null,
```

Extend `publishError` so the chain ends:

```ts
    validateImagesStep(draft) ??
    validatePricingStep(draft) ??
    validateAdvertisingStep(draft) ??
    validatePoliciesStep(draft);
```

- [ ] **Step 7: Document in `SKILL.md`**

In `src/app/dashboard/listings/SKILL.md` under `## Minimal file set per change type`, add:

```markdown
- **Pricing / offers / advertising fields (VAT, Best Offer, multi-buy, ad
  rate, 2026-09-11)**: form state + validators in `_lib/wizardValidation.ts`
  (`EMPTY_PRICING_MARKETING`, `validatePricingStep`,
  `validateAdvertisingStep`), DB mapping in `ListingForm.tsx`'s
  `toFormState`/`toPayload`, UI in `_components/PricingSection.tsx` /
  `AdvertisingSection.tsx`, eBay side in `publishPayloads.ts` (offer) or
  `lib/integrations/ebay/marketing.ts` (post-publish). New test fixtures
  spread `EMPTY_PRICING_MARKETING` instead of listing the 11 keys.
```

and under `## Gotchas`:

```markdown
- **Toggles are form-only; the DB stores values.** `multibuy_enabled` /
  `ad_enabled` don't exist as columns — `multibuy_2_pct` / `ad_rate` being
  non-null IS the switch, and `toPayload()` writes null for every field of a
  switched-off extra. `ad_campaign_id` uses the `NEW_CAMPAIGN` sentinel in
  form state ("create one at publish", saved as null) so it's distinguishable
  from `""` ("not chosen yet"), which `validateAdvertisingStep` rejects.
```

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/listings/_lib/wizardValidation.ts src/app/dashboard/listings/_lib/wizardValidation.test.ts src/app/dashboard/listings/_lib/listingQuality.test.ts src/app/dashboard/listings/_components/ListingForm.tsx src/app/dashboard/listings/SKILL.md
git commit -m "feat(listings): form state and validation for pricing and ad fields

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Advertising section

**Files:**
- Create: `src/app/dashboard/listings/_lib/campaignSelection.ts`
- Test: `src/app/dashboard/listings/_lib/campaignSelection.test.ts`
- Create: `src/app/dashboard/listings/_components/useEbayCampaigns.ts`
- Create: `src/app/dashboard/listings/_components/MarketingReconnectNotice.tsx`
- Create: `src/app/dashboard/listings/_components/AdvertisingSection.tsx`
- Modify: `src/app/dashboard/listings/_components/ListingForm.tsx`
- Modify: `src/app/dashboard/listings/CLAUDE.md`

**Interfaces:**
- Consumes: `NEW_CAMPAIGN`, `MIN_AD_RATE`, `MAX_AD_RATE`, `DraftFormState` (Task 6); `GET /api/listings/ebay/campaigns` (Task 4).
- Produces:
  - `interface CampaignOption { id: string; name: string }`, `resolveCampaignSelection(current: string, campaigns: CampaignOption[]): string` (`_lib/campaignSelection.ts`)
  - `type MarketingAccess = { status: "loading" } | { status: "ready"; campaigns: CampaignOption[] } | { status: "reconnect" } | { status: "error"; message: string }`
  - `useEbayCampaigns(): { access: MarketingAccess; reload: () => void }`
  - `<MarketingReconnectNotice />`
  - `<AdvertisingSection draft setDraft access onRetry />`

- [ ] **Step 1: Write the failing test**

`src/app/dashboard/listings/_lib/campaignSelection.test.ts`:

```ts
import { resolveCampaignSelection } from "./campaignSelection";
import { NEW_CAMPAIGN } from "./wizardValidation";

const campaigns = [
  { id: "c-1", name: "Campaign 13.05.2026 17:18:00" },
  { id: "c-2", name: "Summer" },
];

describe("resolveCampaignSelection", () => {
  it("keeps a campaign that is still in the list", () => {
    expect(resolveCampaignSelection("c-2", campaigns)).toBe("c-2");
  });

  it("keeps an explicit auto-create choice even when campaigns exist", () => {
    expect(resolveCampaignSelection(NEW_CAMPAIGN, campaigns)).toBe(NEW_CAMPAIGN);
  });

  it("falls back to the first campaign when nothing is chosen", () => {
    expect(resolveCampaignSelection("", campaigns)).toBe("c-1");
  });

  it("replaces a campaign that has since ended", () => {
    expect(resolveCampaignSelection("gone", campaigns)).toBe("c-1");
  });

  it("falls back to auto-create when the seller has no campaigns", () => {
    expect(resolveCampaignSelection("", [])).toBe(NEW_CAMPAIGN);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/app/dashboard/listings/_lib/campaignSelection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/app/dashboard/listings/_lib/campaignSelection.ts`:

```ts
import { NEW_CAMPAIGN } from "./wizardValidation";

/** Client-side copy of the campaigns route's item shape (lib/integrations is server-only). */
export interface CampaignOption {
  id: string;
  name: string;
}

/**
 * What the campaign dropdown should hold once the list has loaded: a valid
 * current choice stays (a campaign still in the list, or the explicit
 * auto-create option); otherwise the first campaign, or auto-create when the
 * seller has none. Defaulting to an existing campaign rather than
 * auto-create keeps each new listing from spawning its own campaign.
 */
export function resolveCampaignSelection(current: string, campaigns: CampaignOption[]): string {
  if (current === NEW_CAMPAIGN) return current;
  if (campaigns.some((c) => c.id === current)) return current;
  return campaigns[0]?.id ?? NEW_CAMPAIGN;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/app/dashboard/listings/_lib/campaignSelection.test.ts`
Expected: PASS

- [ ] **Step 5: Create the hook**

`src/app/dashboard/listings/_components/useEbayCampaigns.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import type { CampaignOption } from "../_lib/campaignSelection";

export type MarketingAccess =
  | { status: "loading" }
  | { status: "ready"; campaigns: CampaignOption[] }
  | { status: "reconnect" }
  | { status: "error"; message: string };

/** One fetch of the seller's campaigns, shared by the Pricing (multi-buy)
 *  and Advertising sections — `reconnect` gates both. */
export function useEbayCampaigns(): { access: MarketingAccess; reload: () => void } {
  const [access, setAccess] = useState<MarketingAccess>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Deferred via a microtask so the setState calls don't run synchronously
    // inside the effect body (react-hooks/set-state-in-effect; same pattern
    // as AspectsStep.tsx).
    Promise.resolve().then(async () => {
      setAccess({ status: "loading" });
      try {
        const res = await fetch("/api/listings/ebay/campaigns");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Couldn't load your campaigns.");
        if (cancelled) return;
        setAccess(
          json.needsReconnect
            ? { status: "reconnect" }
            : { status: "ready", campaigns: json.campaigns as CampaignOption[] }
        );
      } catch (err) {
        if (cancelled) return;
        setAccess({
          status: "error",
          message: err instanceof Error ? err.message : "Couldn't load your campaigns.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { access, reload };
}
```

- [ ] **Step 6: Create the reconnect notice**

`src/app/dashboard/listings/_components/MarketingReconnectNotice.tsx`:

```tsx
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/** Shown in place of the multi-buy and advertising controls when the
 *  tenant's eBay token lacks the sell.marketing scope. */
export function MarketingReconnectNotice() {
  return (
    <div className="flex items-start gap-2 rounded-(--radius-btn) border border-[var(--color-warning-text)]/30 bg-(--color-warning-bg) px-3 py-2 text-sm text-(--color-warning-text)">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <p>
        Reconnect eBay to turn on advertising and multi-buy discounts.{" "}
        <Link href="/dashboard/integrations" className="font-medium underline">
          Go to Integrations
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 7: Create the section**

`src/app/dashboard/listings/_components/AdvertisingSection.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { Field, Input, Select, Row, Checkbox } from "@/components/ui/FormFields";
import { Button } from "@/components/ui/Button";
import { createTenantClient } from "@/lib/supabase/client";
import {
  NEW_CAMPAIGN,
  MIN_AD_RATE,
  MAX_AD_RATE,
  type DraftFormState,
} from "../_lib/wizardValidation";
import { resolveCampaignSelection } from "../_lib/campaignSelection";
import { MarketingReconnectNotice } from "./MarketingReconnectNotice";
import type { MarketingAccess } from "./useEbayCampaigns";

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
  access: MarketingAccess;
  onRetry: () => void;
}

export function AdvertisingSection({ draft, setDraft, access, onRetry }: Props) {
  /* Prefill rate + campaign from the most recently advertised listing, so a
   * repeat listing is one tick of the checkbox. Mount-only and only while
   * this draft has no rate of its own — it must never overwrite a value the
   * seller entered. The toggle itself stays off. */
  useEffect(() => {
    if (draft.ad_rate) return;
    let cancelled = false;
    Promise.resolve().then(async () => {
      const supabase = await createTenantClient();
      const { data } = await supabase
        .from("ebay_listing_drafts")
        .select("ad_rate, ad_campaign_id")
        .not("ad_rate", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ ad_rate: number; ad_campaign_id: string | null }>();
      if (cancelled || !data) return;
      setDraft({
        ad_rate: String(data.ad_rate),
        ...(data.ad_campaign_id ? { ad_campaign_id: data.ad_campaign_id } : {}),
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const campaigns = access.status === "ready" ? access.campaigns : null;

  /* Keep the dropdown on a real option once campaigns load (or the prefill
   * lands): an ended campaign, or nothing chosen yet, resolves to the first
   * campaign / auto-create. */
  useEffect(() => {
    if (!campaigns) return;
    const next = resolveCampaignSelection(draft.ad_campaign_id, campaigns);
    if (next !== draft.ad_campaign_id) setDraft({ ad_campaign_id: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, draft.ad_campaign_id]);

  if (access.status === "reconnect") return <MarketingReconnectNotice />;

  return (
    <div className="space-y-4">
      <Checkbox
        label="Promote this listing — you only pay the ad rate when it sells through an ad"
        checked={draft.ad_enabled}
        disabled={access.status !== "ready"}
        onChange={(e) => setDraft({ ad_enabled: e.target.checked })}
      />

      {access.status === "loading" && (
        <p className="text-sm text-(--color-text-muted)">Loading your campaigns…</p>
      )}

      {access.status === "error" && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-(--color-danger-text)">
          <span>Couldn&apos;t load your campaigns: {access.message}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}

      {draft.ad_enabled && campaigns && (
        <Row>
          <Field label="Ad rate (%)" required>
            <Input
              required
              type="number"
              min={MIN_AD_RATE}
              max={MAX_AD_RATE}
              step="0.1"
              value={draft.ad_rate}
              onChange={(e) => setDraft({ ad_rate: e.target.value })}
            />
            <p className="mt-1 text-xs text-(--color-text-faint)">
              A share of the sale price, charged only when a buyer clicks the ad and buys.
            </p>
          </Field>
          <Field label="Campaign" required>
            <Select
              required
              value={draft.ad_campaign_id}
              onChange={(e) => setDraft({ ad_campaign_id: e.target.value })}
            >
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW_CAMPAIGN}>Create a new campaign automatically</option>
            </Select>
          </Field>
        </Row>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Wire it into `ListingForm.tsx`**

Add imports:

```ts
import { AdvertisingSection } from "./AdvertisingSection";
import { useEbayCampaigns } from "./useEbayCampaigns";
```

Inside `ListingForm`, after the `aiUsageToken` state:

```ts
  /* One campaigns fetch for the whole form: Advertising needs the list, and
   * Pricing's multi-buy toggle needs to know whether eBay must be reconnected. */
  const { access: marketingAccess, reload: reloadCampaigns } = useEbayCampaigns();
```

Between the closing `</Section>` of **Listing** and the opening `<Section title="Shipping"`, add:

```tsx
          <Section
            title="Advertising"
            description="Promoted Listings: pay a share of the sale price only when an ad leads to a sale."
          >
            <AdvertisingSection
              draft={draft}
              setDraft={setDraft}
              access={marketingAccess}
              onRetry={reloadCampaigns}
            />
          </Section>
```

- [ ] **Step 9: Update `CLAUDE.md` file map**

In `src/app/dashboard/listings/CLAUDE.md` under `## Files in this folder`, after the `_components/{Source,Category,Aspects,Policies}Step.tsx` entry, add:

```markdown
- `_components/AdvertisingSection.tsx` (2026-09-11) — the form's
  **Advertising** section: "Promote this listing" checkbox, ad rate (2–100,
  one decimal) and campaign `<Select>` (the seller's manual cost-per-sale
  campaigns + "Create a new campaign automatically" = `NEW_CAMPAIGN`).
  Prefills rate/campaign on mount from the most recently updated draft with
  a non-null `ad_rate` (toggle stays off); keeps the dropdown valid via
  `_lib/campaignSelection.ts`'s `resolveCampaignSelection` (tested).
  Campaign data comes from `_components/useEbayCampaigns.ts` — called once
  in `ListingForm.tsx` and passed down as `access`, because
  `PricingSection`'s multi-buy toggle needs the same `reconnect` state.
  `access.status === "reconnect"` renders `MarketingReconnectNotice.tsx`
  (link to Integrations) instead of the controls.
```

- [ ] **Step 10: Run tests**

Run: `npx jest src/app/dashboard/listings`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add src/app/dashboard/listings/_lib/campaignSelection.ts src/app/dashboard/listings/_lib/campaignSelection.test.ts src/app/dashboard/listings/_components/useEbayCampaigns.ts src/app/dashboard/listings/_components/MarketingReconnectNotice.tsx src/app/dashboard/listings/_components/AdvertisingSection.tsx src/app/dashboard/listings/_components/ListingForm.tsx src/app/dashboard/listings/CLAUDE.md
git commit -m "feat(listings): Advertising section with campaign picker and ad rate

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Pricing section (price moves here + VAT, Best Offer, multi-buy) and preview

**Files:**
- Create: `src/app/dashboard/listings/_lib/multiBuy.ts`
- Test: `src/app/dashboard/listings/_lib/multiBuy.test.ts`
- Create: `src/app/dashboard/listings/_components/PricingSection.tsx`
- Modify: `src/app/dashboard/listings/_components/ListingForm.tsx`
- Modify: `src/app/dashboard/listings/_components/ListingPreview.tsx`
- Modify: `src/app/dashboard/listings/CLAUDE.md`

**Interfaces:**
- Consumes: `DraftFormState`, `MULTIBUY_PERCENT_OPTIONS` (Task 6); `MarketingAccess`, `MarketingReconnectNotice` (Task 7).
- Produces: `multiBuyPreviewLines(draft: DraftFormState): string[]`; `<PricingSection draft setDraft access />`.

- [ ] **Step 1: Write the failing test**

`src/app/dashboard/listings/_lib/multiBuy.test.ts`:

```ts
import { multiBuyPreviewLines } from "./multiBuy";
import { EMPTY_PRICING_MARKETING, type DraftFormState } from "./wizardValidation";

function draft(overrides: Partial<DraftFormState> = {}): DraftFormState {
  return {
    ...EMPTY_PRICING_MARKETING,
    source_type: "inventory",
    product_id: "",
    source_url: "",
    title: "",
    description: "",
    price: "16.62",
    currency: "EUR",
    quantity: "5",
    condition: "new",
    category_id: "",
    category_name: "",
    image_urls: [],
    aspects: {},
    required_aspect_names: [],
    fulfillment_policy_id: "",
    payment_policy_id: "",
    return_policy_id: "",
    merchant_location_key: "",
    ...overrides,
  };
}

describe("multiBuyPreviewLines", () => {
  it("is empty while multi-buy is off, even with tiers left in state", () => {
    expect(multiBuyPreviewLines(draft({ multibuy_2_pct: "2" }))).toEqual([]);
  });

  it("lists each set tier", () => {
    expect(
      multiBuyPreviewLines(
        draft({ multibuy_enabled: true, multibuy_2_pct: "2", multibuy_3_pct: "4", multibuy_4_pct: "15" })
      )
    ).toEqual(["Buy 2, save 2%", "Buy 3, save 4%", "Buy 4 or more, save 15%"]);
  });

  it("skips unset tiers", () => {
    expect(multiBuyPreviewLines(draft({ multibuy_enabled: true, multibuy_2_pct: "10" }))).toEqual([
      "Buy 2, save 10%",
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/app/dashboard/listings/_lib/multiBuy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/app/dashboard/listings/_lib/multiBuy.ts`:

```ts
import type { DraftFormState } from "./wizardValidation";

/** The multi-buy lines the preview shows under the price. */
export function multiBuyPreviewLines(draft: DraftFormState): string[] {
  if (!draft.multibuy_enabled) return [];
  const tiers: Array<[string, string]> = [
    ["Buy 2", draft.multibuy_2_pct],
    ["Buy 3", draft.multibuy_3_pct],
    ["Buy 4 or more", draft.multibuy_4_pct],
  ];
  return tiers
    .filter(([, pct]) => pct.trim())
    .map(([label, pct]) => `${label}, save ${pct}%`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/app/dashboard/listings/_lib/multiBuy.test.ts`
Expected: PASS

- [ ] **Step 5: Create `PricingSection.tsx`**

`src/app/dashboard/listings/_components/PricingSection.tsx`:

```tsx
"use client";

import { Lightbulb } from "lucide-react";
import { Field, Input, Select, Row, Checkbox } from "@/components/ui/FormFields";
import { MULTIBUY_PERCENT_OPTIONS, type DraftFormState } from "../_lib/wizardValidation";
import { MarketingReconnectNotice } from "./MarketingReconnectNotice";
import type { MarketingAccess } from "./useEbayCampaigns";
import type { Currency } from "@/types";

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
  access: MarketingAccess;
}

function TierSelect({
  label,
  value,
  required,
  onChange,
}: {
  label: string;
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} required={required}>
      <Select required={required} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{required ? "Select…" : "None"}</option>
        {MULTIBUY_PERCENT_OPTIONS.map((pct) => (
          <option key={pct} value={String(pct)}>
            {pct}%
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function PricingSection({ draft, setDraft, access }: Props) {
  return (
    <>
      <Row>
        <Field label="Price" required>
          <Input
            required
            type="number"
            min="0"
            step="0.01"
            value={draft.price}
            onChange={(e) => setDraft({ price: e.target.value })}
          />
        </Field>
        <Field label="Currency">
          <Select
            value={draft.currency}
            onChange={(e) => setDraft({ currency: e.target.value as Currency })}
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
          </Select>
        </Field>
      </Row>

      <Row>
        <Field label="Quantity" required>
          <Input
            required
            type="number"
            min="1"
            step="1"
            value={draft.quantity}
            onChange={(e) => setDraft({ quantity: e.target.value })}
          />
        </Field>
        <Field label="VAT % (if applicable)">
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={draft.vat_percentage}
            onChange={(e) => setDraft({ vat_percentage: e.target.value })}
          />
          <p className="mt-1 text-xs text-(--color-text-faint)">Included in the price.</p>
        </Field>
      </Row>

      <div className="space-y-3">
        <Checkbox
          label="Allow Best Offer — buyers can send you a price offer"
          checked={draft.best_offer_enabled}
          onChange={(e) => setDraft({ best_offer_enabled: e.target.checked })}
        />
        {draft.best_offer_enabled && (
          <Row>
            <Field label="Auto-accept offers at or above">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={draft.best_offer_auto_accept}
                onChange={(e) => setDraft({ best_offer_auto_accept: e.target.value })}
              />
              <p className="mt-1 text-xs text-(--color-text-faint)">
                Leave blank to review every offer yourself.
              </p>
            </Field>
            <Field label="Auto-decline offers below">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={draft.best_offer_auto_decline}
                onChange={(e) => setDraft({ best_offer_auto_decline: e.target.value })}
              />
            </Field>
          </Row>
        )}
      </div>

      {access.status === "reconnect" ? (
        <MarketingReconnectNotice />
      ) : (
        <div className="space-y-3">
          <Checkbox
            label="Add a multi-buy discount — buyers save when they buy more than one"
            checked={draft.multibuy_enabled}
            onChange={(e) => setDraft({ multibuy_enabled: e.target.checked })}
          />
          {draft.multibuy_enabled && (
            <>
              <p className="flex items-start gap-2 rounded-(--radius-btn) bg-(--color-info-bg) px-3 py-2 text-xs text-(--color-info-text)">
                <Lightbulb size={14} className="mt-0.5 shrink-0" />
                Setting Buy 2 to 10% or more makes buyers more likely to buy more than one.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <TierSelect
                  label="Buy 2 and save"
                  required
                  value={draft.multibuy_2_pct}
                  onChange={(v) => setDraft({ multibuy_2_pct: v })}
                />
                <TierSelect
                  label="Buy 3 and save"
                  value={draft.multibuy_3_pct}
                  onChange={(v) => setDraft({ multibuy_3_pct: v })}
                />
                <TierSelect
                  label="Buy 4 or more and save"
                  value={draft.multibuy_4_pct}
                  onChange={(v) => setDraft({ multibuy_4_pct: v })}
                />
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 6: Rewire `ListingForm.tsx`**

Add the import `import { PricingSection } from "./PricingSection";`.

In the **Listing** section: change its `description` to `"Category, item specifics and condition."`, and replace both `<Row>` blocks (Price/Currency and Quantity/Condition) with just the condition field:

```tsx
            <Field label="Condition" required>
              <Select
                required
                value={draft.condition}
                onChange={(e) =>
                  setDraft({ condition: e.target.value as DraftFormState["condition"] })
                }
              >
                <option value="new">New</option>
                <option value="used">Used</option>
                <option value="refurbished">Refurbished</option>
              </Select>
            </Field>
```

Insert a **Pricing** section between **Listing** and **Advertising**:

```tsx
          <Section
            title="Pricing"
            description="Price, stock, VAT and the offers buyers see."
          >
            <PricingSection draft={draft} setDraft={setDraft} access={marketingAccess} />
          </Section>
```

Then remove imports that are now unused in `ListingForm.tsx` (`Row`, and `Currency` from `@/types` — keep `EbayListingDraft`). The pre-commit eslint run will flag any leftover.

- [ ] **Step 7: Extend the preview**

In `src/app/dashboard/listings/_components/ListingPreview.tsx`, add `import { multiBuyPreviewLines } from "../_lib/multiBuy";`, add `const multiBuyLines = multiBuyPreviewLines(draft);` below `const band = …`, and replace:

```tsx
          <p className="text-xl font-bold text-(--color-text-strong)">
            {formatCurrency(price, draft.currency)}
          </p>
```

with:

```tsx
          <p className="text-xl font-bold text-(--color-text-strong)">
            {formatCurrency(price, draft.currency)}
          </p>
          {draft.best_offer_enabled && (
            <p className="text-sm text-(--color-text-muted)">or Best Offer</p>
          )}
          {multiBuyLines.length > 0 && (
            <ul className="text-sm text-(--color-success-text)">
              {multiBuyLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
```

- [ ] **Step 8: Update `CLAUDE.md`**

In `src/app/dashboard/listings/CLAUDE.md`:
- In the `_components/ListingForm.tsx` entry's **Layout** sentence, change the section list to: **Item** (…), **Listing** (`CategoryStep`, `AspectsStep`, condition), **Pricing** (`PricingSection`), **Advertising** (`AdvertisingSection`) and **Shipping** (`PoliciesStep`) — and change "holding three `<Section>`s" to "holding five `<Section>`s".
- After the `AdvertisingSection.tsx` entry, add:

```markdown
- `_components/PricingSection.tsx` (2026-09-11) — the **Pricing** section:
  price/currency/quantity (moved from Listing), VAT %, "Allow Best Offer"
  (+ optional auto-accept/auto-decline), and "Add a multi-buy discount"
  (Buy 2 required, Buy 3 / Buy 4+ optional, whole % 1–80 from
  `MULTIBUY_PERCENT_OPTIONS`). The multi-buy controls are replaced by
  `MarketingReconnectNotice` when `access.status === "reconnect"` (the
  volume promotion needs the same `sell.marketing` scope as ads). Rules live
  in `validatePricingStep`. `ListingPreview` shows "or Best Offer" and the
  tier lines from `_lib/multiBuy.ts`'s `multiBuyPreviewLines` (tested).
```

- [ ] **Step 9: Run tests**

Run: `npx jest src/app/dashboard/listings`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/app/dashboard/listings/_lib/multiBuy.ts src/app/dashboard/listings/_lib/multiBuy.test.ts src/app/dashboard/listings/_components/PricingSection.tsx src/app/dashboard/listings/_components/ListingForm.tsx src/app/dashboard/listings/_components/ListingPreview.tsx src/app/dashboard/listings/CLAUDE.md
git commit -m "feat(listings): Pricing section with VAT, Best Offer and multi-buy

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Optional item specifics UI

**Files:**
- Create: `src/app/dashboard/listings/_lib/aspectFields.ts`
- Test: `src/app/dashboard/listings/_lib/aspectFields.test.ts`
- Create: `src/app/dashboard/listings/_components/OptionalAspectsGroup.tsx`
- Modify: `src/app/dashboard/listings/_components/AspectsStep.tsx`
- Modify: `src/app/dashboard/listings/CLAUDE.md`

**Interfaces:**
- Consumes: `optionalAspects` from `GET /api/listings/ebay/aspects` (Task 5).
- Produces: `interface OptionalAspect { name: string; values: string[]; mode: "SELECTION_ONLY" | "FREE_TEXT"; recommended: boolean }` (client copy), `type AspectControl = "select" | "combobox" | "text"`, `optionalAspectControl(aspect: OptionalAspect): AspectControl`, `countFilled(values: Record<string, string>, names: string[]): number`; `<OptionalAspectsGroup aspects values onChange />`.

- [ ] **Step 1: Write the failing test**

`src/app/dashboard/listings/_lib/aspectFields.test.ts`:

```ts
import { countFilled, optionalAspectControl, type OptionalAspect } from "./aspectFields";

function aspect(overrides: Partial<OptionalAspect> = {}): OptionalAspect {
  return { name: "Farbe", values: [], mode: "FREE_TEXT", recommended: true, ...overrides };
}

describe("optionalAspectControl", () => {
  it("uses a select for a closed value list", () => {
    expect(optionalAspectControl(aspect({ mode: "SELECTION_ONLY", values: ["Schwarz"] }))).toBe(
      "select"
    );
  });

  it("uses a type-or-pick combobox for free text with suggestions", () => {
    expect(optionalAspectControl(aspect({ values: ["Unbranded"] }))).toBe("combobox");
  });

  it("uses a plain text input when eBay offers no values", () => {
    expect(optionalAspectControl(aspect())).toBe("text");
    // SELECTION_ONLY with no values would be an empty <select> — fall back to text.
    expect(optionalAspectControl(aspect({ mode: "SELECTION_ONLY" }))).toBe("text");
  });
});

describe("countFilled", () => {
  it("counts only named aspects with a non-blank value", () => {
    expect(
      countFilled({ Farbe: "Schwarz", Stil: "  ", Marke: "Acme" }, ["Farbe", "Stil", "Material"])
    ).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/app/dashboard/listings/_lib/aspectFields.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/app/dashboard/listings/_lib/aspectFields.ts`:

```ts
/** Client copy of the aspects route's optional-aspect shape
 *  (lib/integrations/ebay/aspects.ts is server-only). */
export interface OptionalAspect {
  name: string;
  values: string[];
  mode: "SELECTION_ONLY" | "FREE_TEXT";
  recommended: boolean;
}

export type AspectControl = "select" | "combobox" | "text";

export function optionalAspectControl(aspect: OptionalAspect): AspectControl {
  if (aspect.values.length === 0) return "text";
  return aspect.mode === "SELECTION_ONLY" ? "select" : "combobox";
}

export function countFilled(values: Record<string, string>, names: string[]): number {
  return names.filter((name) => values[name]?.trim()).length;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/app/dashboard/listings/_lib/aspectFields.test.ts`
Expected: PASS

- [ ] **Step 5: Create the group component**

`src/app/dashboard/listings/_components/OptionalAspectsGroup.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/FormFields";
import { countFilled, optionalAspectControl, type OptionalAspect } from "../_lib/aspectFields";

interface Props {
  aspects: OptionalAspect[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}

/** eBay's "Other (optional)" item specifics — collapsed by default so the
 *  required fields stay the focus. Nothing here is `required`. */
export function OptionalAspectsGroup({ aspects, values, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const filled = countFilled(values, aspects.map((a) => a.name));

  return (
    <div className="rounded-(--radius-card) border border-(--color-border)">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-(--color-text-strong)">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Other item specifics (optional)
        </span>
        <span className="text-xs text-(--color-text-muted)">
          {filled} of {aspects.length} filled
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-(--color-border) p-4">
          <p className="text-sm text-(--color-text-muted)">
            Buyers also filter by these details.
          </p>
          {aspects.map((aspect, index) => {
            const value = values[aspect.name] ?? "";
            const label = aspect.recommended ? `${aspect.name} (recommended)` : aspect.name;
            const control = optionalAspectControl(aspect);

            if (control === "select") {
              return (
                <Field key={aspect.name} label={label}>
                  <Select value={value} onChange={(e) => onChange(aspect.name, e.target.value)}>
                    <option value="">—</option>
                    {aspect.values.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            }

            const listId = control === "combobox" ? `optional-aspect-values-${index}` : undefined;
            return (
              <Field key={aspect.name} label={label}>
                <Input
                  list={listId}
                  value={value}
                  onChange={(e) => onChange(aspect.name, e.target.value)}
                />
                {listId && (
                  <datalist id={listId}>
                    {aspect.values.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                )}
              </Field>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Render it from `AspectsStep.tsx`**

In `src/app/dashboard/listings/_components/AspectsStep.tsx`:

Add imports:

```ts
import { OptionalAspectsGroup } from "./OptionalAspectsGroup";
import type { OptionalAspect } from "../_lib/aspectFields";
```

Add state below `const [required, setRequired] = …`:

```ts
  const [optional, setOptional] = useState<OptionalAspect[]>([]);
```

In the effect's no-category branch, add `setOptional([]);` next to `setRequired([]);`. In the success branch, after `setRequired(json.aspects);` add:

```ts
        setOptional(json.optionalAspects ?? []);
```

Replace the `if (required.length === 0) { return (…); }` block with:

```tsx
  const optionalGroup =
    optional.length > 0 ? (
      <OptionalAspectsGroup aspects={optional} values={draft.aspects} onChange={updateAspect} />
    ) : null;

  if (required.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-(--color-text-muted)">
          No additional item details are required for this category.
        </p>
        {optionalGroup}
      </div>
    );
  }
```

and in the final `return`, add `{optionalGroup}` immediately before the closing `</div>` (after the `required.map(…)` block).

(`updateAspect` writes into the same `draft.aspects` map, which `buildInventoryItemPayload` already sends in full — no payload change. `validateAspectsStep` only checks `required_aspect_names`, so optional fields never block Publish.)

- [ ] **Step 7: Update `CLAUDE.md`**

In the `AspectsStep` part of the `_components/{Source,Category,Aspects,Policies}Step.tsx` entry, append:

```markdown
  Since 2026-09-11 it also renders `_components/OptionalAspectsGroup.tsx`
  below the required fields (and under the "No additional item details are
  required" line when there are none): a collapsed-by-default "Other item
  specifics (optional)" group fed by the aspects route's `optionalAspects`
  (RECOMMENDED first). Control per aspect comes from `_lib/aspectFields.ts`'s
  `optionalAspectControl` (tested): closed list → `<Select>`, free text with
  suggestions → `<Input list>` + `<datalist>`, otherwise plain `<Input>`.
  Values go into the same `draft.aspects` map; none are `required`, and
  "Fill with AI" still only covers the required set.
```

- [ ] **Step 8: Run tests**

Run: `npx jest src/app/dashboard/listings`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard/listings/_lib/aspectFields.ts src/app/dashboard/listings/_lib/aspectFields.test.ts src/app/dashboard/listings/_components/OptionalAspectsGroup.tsx src/app/dashboard/listings/_components/AspectsStep.tsx src/app/dashboard/listings/CLAUDE.md
git commit -m "feat(listings): collapsible optional item specifics

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Live-page retry banner

**Files:**
- Create: `src/app/dashboard/listings/_components/MarketingRetryBanner.tsx`
- Modify: `src/app/dashboard/listings/[id]/live/page.tsx`
- Modify: `src/app/dashboard/listings/CLAUDE.md`

**Interfaces:**
- Consumes: `POST /api/listings/[id]/apply-marketing` (Task 4), `updateListingDraft` (existing slice action).
- Produces: `<MarketingRetryBanner draftId={string} />` — renders nothing unless the row's `marketing_error` is set.

No new pure logic → no new unit test; covered by Task 3's `runMarketingSteps` tests plus the manual check in Task 11.

- [ ] **Step 1: Create the banner**

`src/app/dashboard/listings/_components/MarketingRetryBanner.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch } from "@/store/hooks";
import { createTenantClient } from "@/lib/supabase/client";
import { updateListingDraft } from "../_store/listingsSlice";
import type { EbayListingDraft } from "@/types";

/** Shown on a live listing whose ad or multi-buy discount failed after
 *  publish. Retry re-runs only the missing steps (never duplicates). */
export function MarketingRetryBanner({ draftId }: { draftId: string }) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const [message, setMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      const supabase = await createTenantClient();
      const { data } = await supabase
        .from("ebay_listing_drafts")
        .select("marketing_error")
        .eq("id", draftId)
        .maybeSingle<Pick<EbayListingDraft, "marketing_error">>();
      if (!cancelled) setMessage(data?.marketing_error ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  async function retry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/listings/${draftId}/apply-marketing`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Retry failed.");
      dispatch(updateListingDraft(json.draft));
      const warnings: string[] = json.warnings ?? [];
      if (warnings.length > 0) {
        setMessage(warnings.join(" "));
        toastError("Still couldn't apply everything.", warnings.join(" "));
      } else {
        setMessage(null);
        success("Advertising and discounts applied.");
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  }

  if (!message) return null;

  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-start gap-3 rounded-(--radius-btn) border border-[var(--color-warning-text)]/30 bg-(--color-warning-bg) px-4 py-3 text-sm text-(--color-warning-text)"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <p className="flex-1">
        This listing is live, but advertising or the multi-buy discount wasn&apos;t applied:{" "}
        {message}
      </p>
      <Button type="button" variant="secondary" size="sm" onClick={retry} disabled={retrying}>
        <RefreshCw size={14} className={retrying ? "animate-spin" : undefined} />
        {retrying ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Render it on the live page**

Replace `src/app/dashboard/listings/[id]/live/page.tsx` with:

```tsx
"use client";

import { use } from "react";
import { EditLiveListing } from "../../_components/EditLiveListing";
import { BusinessEbayGate } from "../../_components/BusinessEbayGate";
import { MarketingRetryBanner } from "../../_components/MarketingRetryBanner";

export default function LiveListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <BusinessEbayGate>
      <MarketingRetryBanner draftId={id} />
      <EditLiveListing draftId={id} />
    </BusinessEbayGate>
  );
}
```

- [ ] **Step 3: Update `CLAUDE.md`**

In `src/app/dashboard/listings/CLAUDE.md` file map, add:

```markdown
- `_components/MarketingRetryBanner.tsx` (2026-09-11) — rendered by
  `[id]/live/page.tsx` above `EditLiveListing`. Reads the row's
  `marketing_error` directly (tenant client) and renders nothing when it's
  null. Its Retry button calls `POST /api/listings/[id]/apply-marketing`
  (busy "Retrying…", toast both ways) and dispatches `updateListingDraft`
  with the returned row. This is the only live-page change in the
  2026-09-11 pricing/marketing work — editing ad rates or discounts on live
  listings is a follow-up.
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/app/dashboard/listings`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/listings/_components/MarketingRetryBanner.tsx "src/app/dashboard/listings/[id]/live/page.tsx" src/app/dashboard/listings/CLAUDE.md
git commit -m "feat(listings): retry banner for failed ads or multi-buy on live listings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Apply migrations, sandbox verification, PR

This task needs the user: applying SQL to the live databases and reconnecting eBay are outward-facing. **Ask before each.**

- [ ] **Step 1: Apply the SQL (with the user's OK)**

Ask the user to confirm, then apply to Project B (tenant data) via the `supabase-data` MCP `execute_sql`: first the full contents of `044_ebay_listing_drafts_pricing_marketing.sql`, then the `CREATE OR REPLACE FUNCTION public.provision_tenant_schema` block from `005_tenant_provisioning.sql`. Verify:

```sql
select table_schema, count(*) from information_schema.columns
where table_name = 'ebay_listing_drafts'
  and column_name in ('vat_percentage','best_offer_enabled','best_offer_auto_accept','best_offer_auto_decline','multibuy_2_pct','multibuy_3_pct','multibuy_4_pct','ad_rate','ad_campaign_id','ebay_ad_id','ebay_promotion_id','marketing_error')
group by table_schema;
```

Expected: every `tenant_%` schema reports 12. Then flip the `044` row in `supabase/SKILL.md` from ⏳ pending to applied (match the wording other applied rows use).

- [ ] **Step 2: Sandbox checks (the user drives the browser, or Playwright MCP if `npm run dev` is already running)**

With `EBAY_SANDBOX=true` and a sandbox seller **reconnected** in Integrations (to grant `sell.marketing`), create and publish listings that exercise each question from the spec's §6. Record each answer:

1. **Best Offer + multi-buy on one listing.** Publish with both on. If eBay rejects the offer or the promotion because of the combination, make them mutually exclusive: in `PricingSection.tsx` disable the multi-buy checkbox while `draft.best_offer_enabled` (and vice versa) with the line "eBay doesn't allow Best Offer and multi-buy on the same listing.", and add to `validatePricingStep` (with a test): `if (draft.best_offer_enabled && draft.multibuy_enabled) return "eBay doesn't allow Best Offer and multi-buy on the same listing.";`
2. **Minimum ad rate.** Try 2.0 and 1.9 via a draft saved through the form. If eBay's minimum differs, change `MIN_AD_RATE`, the `ad_rate` CHECK (new migration `045_…` via `run_on_all_tenant_schemas` + 005), and the tests.
3. **Volume promotion end date.** If `createItemPromotion` rejects a missing `endDate`, add to `buildVolumeDiscountPayload` `endDate: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),` (and to `VolumeDiscountPayload` + its test). Also confirm a `startDate` of "now" isn't rejected as being in the past; if it is, offset `startDate` by +60s in both the campaign and promotion builders (and tests).
4. **Accepted multi-buy percentages.** Try 1%, 3% and 80%. If eBay only accepts specific values, replace `MULTIBUY_PERCENT_OPTIONS` with that list, adjust the `multibuy_*_pct` CHECKs (new migration) and tests.
5. **Campaign filter.** Confirm a campaign created in Seller Hub the way the user's "Campaign 13.05.2026 17:18:00" was appears in the dropdown, and a rules-based one doesn't.
6. **Reconnect path.** On a connection authorised *before* this change, confirm the form shows the reconnect notice in Pricing and Advertising, and that Publish still works without them.
7. **Retry path.** Force a failure (e.g. choose a campaign, then end it on eBay before publishing): publish → warning toast → live page banner → end-to-end Retry after fixing.
8. **Optional specifics.** Pick the wallet category from the user's screenshot; confirm Department/Farbe/etc. show up, fill some, publish, and check they appear on the eBay listing.

Fix anything found, with a test and a commit per fix.

- [ ] **Step 3: Final docs pass**

In `src/app/dashboard/listings/SKILL.md` `## Gotchas`, add a bullet recording each sandbox answer from Step 2 (e.g. "Best Offer and multi-buy **can / cannot** coexist — confirmed in sandbox 2026-09-__"), so the next agent doesn't re-test them. Commit:

```bash
git add src/app/dashboard/listings/SKILL.md supabase/SKILL.md
git commit -m "docs(listings): record sandbox-verified eBay marketing limits

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push and open the PR (with the user's OK)**

```bash
git push -u origin feat/listing-pricing-marketing
gh pr create --base main --title "Listings: VAT, Best Offer, multi-buy, Promoted Listings and optional specifics" --body-file /path/to/scratchpad/pr-body.md
```

Write `pr-body.md` (in the session scratchpad) with these sections, filled from the actual commits and Step 2's findings:

```markdown
## What
- Create-listing form gains **Pricing** (VAT %, Best Offer + thresholds, multi-buy tiers) and **Advertising** (Promoted Listings ad rate + campaign) sections, and a collapsible **Other item specifics (optional)** group.
- Publish now adds the listing to a campaign and creates the multi-buy promotion after `publishOffer`; failures leave the listing live and show a Retry banner on the live page (`POST /api/listings/[id]/apply-marketing`).
- Migration `044` (+ `provision_tenant_schema()`), applied to all tenant schemas.

## ⚠️ Rollout
Adds the `sell.marketing` eBay scope. **Every tenant must disconnect and reconnect eBay once** to use advertising and multi-buy; until then the form shows a reconnect notice and publishing still works.

## Sandbox findings
<one line per item from Task 11 Step 2, with the answer>

## Tests
<the focused `npx jest` commands run and their results>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
