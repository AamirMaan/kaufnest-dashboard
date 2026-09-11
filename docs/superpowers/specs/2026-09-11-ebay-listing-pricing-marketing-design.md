# eBay listing: pricing, offers, advertising and optional item specifics

**Date:** 2026-09-11
**Feature:** `src/app/dashboard/listings/` (create/publish form) + `src/lib/integrations/ebay/`
**Status:** design approved, not yet implemented

## Goal

A seller creating a listing in the app should never have to open eBay Seller
Hub to finish configuring it. Today the create form sends title, description,
images, required item specifics, price/quantity/condition, category, business
policies and location. It is missing four things sellers routinely set on eBay:

1. **VAT %** on the offer.
2. **Best Offer** — buyers can send a price offer, with optional auto-accept /
   auto-decline thresholds.
3. **Multi-buy discount** — "Buy 2 / 3 / 4+ and save X%" (eBay volume pricing).
4. **Advertising** — a per-listing Promoted Listings (cost-per-sale) ad rate,
   inside a campaign.
5. **Optional item specifics** — the recommended/optional aspects eBay shows
   under "Other (optional)"; the form only shows required ones today.

## Scope

**In scope:** the create/publish form (`ListingForm.tsx`) and the publish route,
plus a Retry banner on the live-listing page for post-publish marketing
failures.

**Out of scope (follow-ups):**

- Editing any of these fields on already-live listings (`EditLiveListing.tsx`,
  Trading API `ReviseItem`). Separate project.
- eBay's "recommended price" / "sold offers in the last 90 days" panel — eBay
  does not expose sold-price data to ordinary apps (Marketplace Insights API
  is restricted).
- eBay's "recommended advertising rate" — the Recommendation API needs an
  existing listing ID, so it can't inform the create form.
- Multi-value item specifics (aspects with `MULTI` cardinality still take one
  value).
- "Fill with AI" for optional item specifics — stays required-only, so AI
  quota isn't spent on cosmetic fields.

## Decisions

| Question | Decision |
| --- | --- |
| "Offers" meant multi-buy or Best Offer? | Both. |
| Live listings too? | New listings first; live-edit is a follow-up. |
| Which campaign gets the ad? | Dropdown of the tenant's running manual cost-per-sale campaigns, defaulting to the last one used; "Create a new campaign automatically" when there are none (or chosen explicitly). |
| Where do the marketing calls run? | In the existing publish route, after `publishOffer` succeeds (approach A). Failures there never un-publish the listing. |

Rejected: a client-orchestrated sequence of `publish` → `/ad` → `/discount`
calls (a closed tab mid-sequence leaves a live listing with no ad and no record
of it), and rolling back the listing when a marketing step fails (throws away a
valid listing over an optional add-on).

## 1. Form

The form stays a single scrolling page (`ListingForm.tsx`). Sections become:
**Item → Listing → Pricing (new) → Advertising (new) → Shipping.**

### Listing — "Other item specifics (optional)"

Below `AspectsStep`'s required fields, a collapsible group (collapsed by
default, header shows "N of M filled") renders the category's non-required
aspects — `RECOMMENDED` usage first, then `OPTIONAL`.

Field type per aspect:

- `aspectMode: SELECTION_ONLY` with values → `<Select>`.
- `FREE_TEXT` with suggested values → `<Input list=…>` + `<datalist>` (type or
  pick, like eBay's Brand → "Unbranded").
- `FREE_TEXT` with no values → plain `<Input>`.

None of these carry `required`. Values write into the existing `draft.aspects`
map and reach eBay through `buildInventoryItemPayload` unchanged (it already
sends every non-blank entry).

### Pricing (new section)

Price, currency and quantity **move here from Listing**, alongside:

- **VAT %** — optional number input, helper text "Included in the price".
  Range 0–100, two decimals.
- **Best Offer** — toggle. When on: optional **auto-accept price** and
  optional **auto-decline price**. Rules: each < price; decline < accept when
  both set.
- **Multi-buy discount** — toggle. When on: **Buy 2** (required), **Buy 3**
  and **Buy 4 or more** (optional) as whole-percent `<Select>`s. Each set tier
  must be strictly greater than the previous set tier; Buy 4+ requires Buy 3.
  Hint text: setting Buy 2 to 10% or more increases the chance of multi-item
  purchases.

### Advertising (new section)

Promoted Listings General (cost-per-sale):

- Toggle **Promote this listing**.
- **Ad rate %** — 2.0–100.0, one decimal.
- **Campaign** — `<Select>` fed by `GET /api/listings/ebay/campaigns`; last
  option "Create a new campaign automatically" (stored as `ad_campaign_id =
  null`).
- Prefill: on a new draft, campaign + rate default to the most recent draft
  that has `ad_rate` set (one extra `select … order by updated_at desc limit
  1` on form load). No new settings table.

**Reconnect state:** if the campaigns route returns `needsReconnect: true`,
the Advertising section's controls and the Pricing section's multi-buy toggle
are replaced by an inline notice — "Reconnect eBay to turn on advertising and
multi-buy discounts" — linking to `/dashboard/integrations`. Publishing still
works without them.

**Load failure (not a permission problem):** the Advertising section shows
"Couldn't load your campaigns" with a Retry link; the toggle is disabled.

### Publish gate & preview

New validators in `_lib/wizardValidation.ts` — `validatePricingStep` and
`validateAdvertisingStep` — are `??`-chained into the existing
`publishError`, so Publish is disabled with an explanation while any rule
fails. Save Draft stays ungated (incomplete drafts remain a supported state).

`ListingPreview` gains an "or Best Offer" line under the price and the
multi-buy tiers ("Buy 2, save 2%" …).

### Form conventions

Per `AGENTS.md`: every new `<button>` inside the `<form>` is `type="button"`;
required inputs carry `required`; Retry buttons show a busy label and toast on
both outcomes.

## 2. Data model

Migration `044_ebay_listing_drafts_pricing_marketing.sql`, via
`public.run_on_all_tenant_schemas`, **and** the same columns added to
`provision_tenant_schema()` in `005_tenant_provisioning.sql` (the 2-places
rule). Columns on `ebay_listing_drafts`:

| Column | Type | Meaning |
| --- | --- | --- |
| `vat_percentage` | `numeric(5,2)` null, CHECK 0–100 | VAT %; null = not sent |
| `best_offer_enabled` | `boolean NOT NULL DEFAULT false` | Best Offer toggle |
| `best_offer_auto_accept` | `numeric(12,2)` null | auto-accept price |
| `best_offer_auto_decline` | `numeric(12,2)` null | auto-decline price; CHECK `< best_offer_auto_accept` when both set |
| `multibuy_2_pct` | `smallint` null, CHECK 1–80 | Buy 2 tier; non-null = multi-buy on |
| `multibuy_3_pct` | `smallint` null, CHECK 1–80 | Buy 3 tier |
| `multibuy_4_pct` | `smallint` null, CHECK 1–80 | Buy 4+ tier |
| `ad_rate` | `numeric(4,1)` null, CHECK 2–100 | ad rate %; null = not promoted |
| `ad_campaign_id` | `text` null | chosen campaign; null + `ad_rate` = auto-create |
| `ebay_ad_id` | `text` null | ad eBay created (step result) |
| `ebay_promotion_id` | `text` null | volume promotion eBay created (step result) |
| `marketing_error` | `text` null | last post-publish failure; cleared on success |

The 1–80 and 2–100 bounds are provisional — see "Sandbox verification".

`EbayListingDraft` (`src/types/index.ts`), `DraftFormState`, and
`ListingForm.toPayload()` gain the matching fields (form state as strings,
converted in `toPayload()` like `price` is today).

## 3. eBay integration

### Scope

Add `https://api.ebay.com/oauth/api_scope/sell.marketing` to `EBAY_SCOPE` in
`src/lib/integrations/ebay.ts`. Existing connections keep their old scopes on
refresh (refresh omits `scope` by design), so **each tenant must disconnect
and reconnect eBay once** to use advertising and multi-buy. We don't store
granted scopes; a 403 from the Marketing API is the detection signal.

### Offer payload (`publishPayloads.ts`)

- `tax: { vatPercentage, applyTax: true }` — only when `vat_percentage` is set.
- `listingPolicies.bestOfferTerms: { bestOfferEnabled: true, autoAcceptPrice?,
  autoDeclinePrice? }` — only when `best_offer_enabled`; prices as `{ value,
  currency }` with two decimals.

Both ride the existing create/update-offer call; `OfferPayload` gains the two
optional properties.

### Category aspects (`publish.ts`)

A sibling `fetchCategoryAspects(categoryId)` returns **all** aspects with
`usage` (`REQUIRED` / `RECOMMENDED` / `OPTIONAL`), `mode` (`SELECTION_ONLY` /
`FREE_TEXT`) and `values`. `fetchRequiredAspects` becomes a filter over it, so
its callers — and the AI aspects route — keep receiving only required names.
`GET /api/listings/ebay/aspects` adds an `optionalAspects` array to its
response for the new collapsible group.

### New module `src/lib/integrations/ebay/marketing.ts` (server-only)

- `fetchManualCampaigns(token)` → `{ campaigns: {id, name}[] } | {
  needsReconnect: true }`. Lists `RUNNING` + `SCHEDULED` `COST_PER_SALE`
  campaigns and keeps only those on `MARKETPLACE_ID` **without a
  `campaignCriterion`** (rules-based campaigns reject manually added
  listings). HTTP 403 → `needsReconnect`.
- `createCampaign(token)` → campaign id. Name `Boughtopia listings
  YYYY-MM-DD`, `COST_PER_SALE`, `startDate` now, `MARKETPLACE_ID`.
- `addListingToCampaign(token, campaignId, listingId, rate)` → ad id.
- `createVolumeDiscount(token, listingId, tiers, currency)` → promotion id.

Pure builders, exported for tests (in `publishPayloads.ts` next to the offer
builders):

- `buildAdPayload(listingId, rate)` — `bidPercentage` as a one-decimal string.
- `buildVolumeDiscountPayload(listingId, tiers, marketplaceId, now)` —
  `promotionType: VOLUME_DISCOUNT`, `inventoryCriterion` by listing ID, and
  `discountRules` = eBay's required `minQuantity: 1 / 0%` base rule followed
  by each set tier in order (`ruleOrder` sequential), unset tiers dropped.

### Route: `GET /api/listings/ebay/campaigns`

Same auth/permission guard as the sibling `ebay/*` routes (`manage_listings`,
connected eBay account). Returns `{ campaigns, needsReconnect }`.

### Publish route (`/api/listings/[id]/publish`)

1. **Unchanged behaviour**: inventory item → offer (now with tax/Best Offer)
   → publish → mark draft `published`. Any failure here marks the draft
   `failed` with `publish_error` and stops — no marketing step runs.
2. `runMarketingSteps(draft, listingId, api)` (new, in `marketing.ts`, with
   the eBay calls injected so it is testable without HTTP):
   - **Ad** — if `ad_rate` set and `ebay_ad_id` empty: use `ad_campaign_id`
     or `createCampaign` (persist the new id immediately) → `addListingToCampaign`
     → persist `ebay_ad_id`.
   - **Multi-buy** — if `multibuy_2_pct` set and `ebay_promotion_id` empty:
     `createVolumeDiscount` → persist `ebay_promotion_id`.
   - The two steps are independent: one failing doesn't skip the other.
     Failure messages are joined into `marketing_error`; full success clears
     it.
3. Response: `200 { listingId, warnings: string[] }` — `warnings` empty on
   full success.

### Route: `POST /api/listings/[id]/apply-marketing`

Same guard. Requires `status = 'published'` and `ebay_listing_id`. Runs only
`runMarketingSteps`; because each step skips when its id is already stored,
retries never create a duplicate ad or promotion. Returns `{ warnings }`.

## 4. Error handling & UX

| Situation | Behaviour |
| --- | --- |
| Marketing permission missing | Reconnect notice in form; publish unaffected |
| Campaign list fails to load | "Couldn't load your campaigns" + Retry; ad toggle disabled |
| Invalid pricing/ad input | Publish disabled with the validator's message |
| Core publish fails | As today: draft `failed`, `publish_error`, error toast |
| Ad and/or multi-buy fails | Listing stays live; `marketing_error` stored; form shows a **warning** toast ("Listing is live, but …") instead of the success toast, then navigates to the list as today |
| Retry | `[id]/live` page shows a banner when `marketing_error` is set, with a **Retry** button (`Retrying…` busy label, toast on both outcomes) calling `apply-marketing`; the banner disappears on success |

eBay's own error text is surfaced (existing `throwIfNotOk` pattern); no raw
Postgres errors reach the client.

## 5. Testing

Colocated, pure, run with focused `npx jest` paths:

- `lib/integrations/ebay/publishPayloads.test.ts` — `tax` and
  `bestOfferTerms` present only when set; Best Offer prices formatted to two
  decimals; `buildAdPayload` one-decimal rate; `buildVolumeDiscountPayload`
  adds the 0% base rule, orders tiers, drops unset Buy 3/4+.
- `lib/integrations/ebay/marketing.test.ts` — campaign filtering (drops
  rules-based, other-marketplace, ended); 403 → `needsReconnect`;
  `runMarketingSteps` skips completed steps, runs the second step when the
  first fails, collects messages, clears `marketing_error` on full success,
  persists a newly created campaign id before adding the ad.
- `listings/_lib/wizardValidation.test.ts` — `validatePricingStep` (VAT
  range, Best Offer threshold ordering vs price, multi-buy strictly
  increasing, Buy 4+ requires Buy 3) and `validateAdvertisingStep` (rate
  range and precision; campaign or auto-create chosen).
- Optional-aspect classification (a pure helper in `listings/_lib/`, e.g.
  `aspectFields.ts`) — required vs recommended vs optional ordering; select
  vs datalist vs plain input.

## 6. Sandbox verification (before merge)

eBay's API reference pages could not be fetched during design, so these are
confirmed against the sandbox during implementation; validators and CHECK
constraints are adjusted to match:

1. Whether Best Offer and a volume discount can coexist on one listing. If
   not, the two toggles become mutually exclusive with an explanatory line.
2. The minimum Promoted Listings ad rate (assumed 2.0%).
3. Whether a `VOLUME_DISCOUNT` promotion requires an `endDate`.
4. Which multi-buy percentages eBay accepts (assumed whole numbers 1–80).

## 7. Docs to update (same commit as the code)

- `src/app/dashboard/listings/CLAUDE.md` — new sections, new routes, file map.
- `src/app/dashboard/listings/SKILL.md` — minimal file sets for "add a
  pricing/marketing field"; gotchas (marketing steps never un-publish;
  step-id idempotency; reconnect detection via 403).
- `src/lib/integrations/SKILL.md` — `sell.marketing` scope and the one-time
  reconnect.
- `supabase/SKILL.md` — migration 044 row in the file-map table.
