---
name: listings-feature
description: Agent playbook for the eBay listing creation feature (src/app/dashboard/listings) — minimal file set per change type, gotchas around SKU/offer resumability, Storage bucket RLS, and the AuditEntity type gap.
---

# Listings feature playbook

## Minimal file set per change type

- **New wizard field** (e.g. an "item specifics" step): add it to
  `DraftFormState` in `_lib/wizardValidation.ts`, add a validator if it's
  required, add/extend a step component, wire it into `ListingWizard.tsx`'s
  `STEPS`/`VALIDATORS`/switch and its `toPayload()`, add the DB column via the
  "2 places" rule (`supabase/SKILL.md`) — `021_ebay_listing_drafts.sql`-style
  new migration using `run_on_all_tenant_schemas` PLUS
  `provision_tenant_schema()` — and add it to
  `buildInventoryItemPayload`/`buildOfferPayload` in
  `lib/integrations/ebay/publishPayloads.ts` if eBay needs it at publish
  time.
- **New eBay-read call** (e.g. shipping rate tables): add the function to
  `lib/integrations/ebay/publish.ts` (unauthenticated by jest, matches
  `ebay.ts`/`amazon.ts`), add a `GET /api/listings/ebay/<thing>/route.ts`
  following `categories`/`policies`'s shape exactly (guard, connection check,
  token refresh, try/catch → 502).
- **Changing the publish flow itself**: `publishListing` in
  `lib/integrations/ebay/publish.ts` + the resumability logic in
  `app/api/listings/[id]/publish/route.ts` — read both together, the route
  owns the `status`/`ebay_sku`/`ebay_offer_id` persistence, `publishListing`
  owns the actual eBay calls.
- **Changing the plan/connection gate**: `_components/BusinessEbayGate.tsx`
  is the single source of truth — used by `page.tsx`, `new/page.tsx`, AND
  `[id]/page.tsx`. Change the copy/condition there, not in any individual
  route file.

## Gotchas

- **Listings is Business-plan-only, not Pro+Business — CHANGED 2026-08-27,
  and the wizard routes had no gate at all until the same change.**
  `hasPlatformIntegrations` (Pro + Business) was the original gate on
  `page.tsx` only; it's now `hasMessagingAndListings` (Business only, see
  `lib/utils/planGating.ts`) PLUS a connected-eBay check, applied via
  `_components/BusinessEbayGate.tsx` to **all three** routes. Before this,
  `new/page.tsx`/`[id]/page.tsx` rendered `ListingWizard` with no gate
  whatsoever — a Pro tenant, or one with no eBay connection at all, could
  reach the wizard by navigating straight to the URL even though the list
  page's "New Listing" button was correctly hidden from them. Don't
  reintroduce a route that renders `ListingWizard` without wrapping it in
  `BusinessEbayGate`.
- **Category search needs an application token, not the seller's user
  token — fixed.** `searchCategories` (Taxonomy API,
  `lib/integrations/ebay/publish.ts`) used to be called with the tenant's
  eBay connection's user access token, which 403s (errorId 1100,
  "Insufficient permissions") because that token is only authorized with
  `sell.fulfillment`/`sell.inventory`, not the base
  `https://api.ebay.com/oauth/api_scope` the Taxonomy API checks for.
  Category trees are global eBay catalog data, not seller-specific, so the
  fix was an eBay *application* token (client_credentials grant) via the
  new `lib/integrations/ebay/appToken.ts` — same pattern already used by
  `publicKey.ts` for the same reason. The route
  (`app/api/listings/ebay/categories/route.ts`) still checks the tenant has
  a connected eBay account first (UX gate — no point letting someone search
  categories before they've connected eBay), it just no longer needs to
  refresh/pass that connection's token into `searchCategories` itself.
  `fetchBusinessPolicies` (Account API) is genuinely seller-specific and
  correctly still uses the user token — don't "fix" that one the same way.
- **`AuditEntity` has no `"listing"` value.** `types/index.ts`'s
  `AuditEntity` is `"expense" | "purchase" | "sale" | "user" | "product"` —
  adding a 6th value is a one-line, low-risk change but wasn't done for v1 to
  keep this feature's diff self-contained from a type other features also
  consume. `ListingWizard.tsx` currently logs listing create/update audit
  entries with `entityType: "sale"` as the closest existing category — **fix
  this** by adding `"listing"` to `AuditEntity` and updating
  `ListingWizard.tsx`'s two `writeAuditLog` calls the next time this file is
  touched for an unrelated reason (small enough to bundle, not urgent enough
  to justify its own PR).
- **Offer-creation resume gap — fixed.** `publishListing` now takes an
  optional `onOfferCreated(offerId)` callback (5th param) that fires
  immediately after `createOffer` returns a new `offerId`, before
  `publishOffer` is attempted. The publish route
  (`app/api/listings/[id]/publish/route.ts`) passes a callback that writes
  `ebay_offer_id` to the draft row right away, so if `publishOffer` then
  throws, a retry resumes with `updateOffer` instead of calling `createOffer`
  again. The catch block's own `.update()` still only writes
  `status`/`ebay_sku`/`publish_error` — it relies on the callback having
  already persisted `ebay_offer_id` earlier in the same request, not on
  writing it itself.
- **Save Draft / Publish skip the step validators.** `_lib/wizardValidation.ts`'s
  five validators (`validateSourceStep` … `validatePoliciesStep`) only run
  from `ListingWizard.tsx`'s `goNext()`, when the user clicks "Next" within
  the wizard. `handleSaveDraft`/`handlePublish` call `saveDraft()` directly
  with no validation pass, so a user can click Save Draft on step 1 with an
  empty title, zero/blank price, or no images and get a row written to
  `ebay_listing_drafts` — the DB has minimal CHECK constraints
  (`price >= 0`, `quantity >= 1`, `NOT NULL title`) but nothing enforcing a
  non-blank title or that later-step fields are populated. This is
  intentional (drafts are explicitly allowed to be incomplete — that's the
  point of a draft), but the actual eBay publish call will still fail
  server-side (400/502 from eBay) on a draft missing category/policies/
  images, since those are required by eBay's Inventory API regardless of
  local validation. Don't assume "it saved" implies "it's valid to publish."
- **Storage bucket path convention is load-bearing for RLS**: images MUST
  upload to `{tenant_schema}/{draftId}/{filename}` — the `listing-images`
  bucket's write/delete RLS policies (`022_listing_images_bucket.sql`) check
  `(storage.foldername(name))[1]` against the caller's JWT `tenant_schema`
  claim. Uploading anywhere else silently fails the RLS check (403).
- **`listing-images` SELECT policy is fully public, not just "public URLs
  work"**: `022_listing_images_bucket.sql`'s `listing_images_public_read`
  policy is `FOR SELECT USING (bucket_id = 'listing-images')` — no path or
  auth restriction at all. This means anyone, including an unauthenticated
  caller, can also *list/enumerate* the bucket's contents (all tenants'
  paths), not merely fetch an image at a URL they already know. This was
  flagged during Task 7's review as an intentional tradeoff — eBay needs
  public image URLs, and this codebase doesn't yet have a public image-CDN
  pattern to reuse — not a bug. Don't put anything sensitive in this bucket.
- **Unsaved-draft image orphaning**: `ImagesStep.tsx` uploads under a
  `"unsaved"` folder when `draftId` is null (new draft, not yet saved). If
  the user uploads images then abandons the wizard without ever clicking
  Save Draft/Publish, those files are never cleaned up. No cleanup job
  exists for this in v1 — acceptable given Storage cost is low, flagged here
  so it isn't mistaken for an oversight.
- **eBay Inventory API needs Business Policies pre-configured on the
  tenant's real eBay seller account** — `PoliciesStep.tsx` will show empty
  dropdowns (not an error) if the connected eBay account has none. There's
  no in-app guidance for setting these up on eBay's side; the design spec's
  "Approach" section explains why this was assumed rather than solved for.
  **Distinguish this from a 403** (`fetchBusinessPolicies` failing outright
  with errorId 1100 "Insufficient permissions") — that's not "no policies
  configured," it's the connection missing the `sell.account` OAuth scope
  (fixed by adding it to `EBAY_SCOPE` in `ebay.ts`, but any connection made
  *before* that fix still lacks it and needs to disconnect/reconnect in
  Integrations — a code deploy alone doesn't retroactively add scope to an
  already-issued token). Unlike category search (see above), this one
  correctly uses the tenant's own user token — Business Policies really are
  seller-specific, an application token wouldn't work here.
- **Single marketplace, hardcoded via `EBAY_MARKETPLACE_ID` env var**
  (`lib/integrations/ebay/publish.ts`, defaults `"EBAY_DE"`) — every draft
  publishes to the same marketplace regardless of `draft.currency`. Setting
  `currency: "USD"` on a draft does NOT change which eBay site it lists on.
- **`EBAY_CATEGORY_TREE_ID` env var** (defaults `"77"`, eBay's ID for the
  Germany category tree) must match whichever marketplace
  `EBAY_MARKETPLACE_ID` points at — mismatched tree/marketplace IDs return
  category suggestions that `createOffer` then rejects as invalid for that
  marketplace.
- **`EBAY_MERCHANT_LOCATION_KEY` env var — required, no default.** Every
  eBay Offer must reference a `merchantLocationKey` pointing at an existing
  inventory location in the seller's eBay account, or `publishOffer` fails.
  Unlike `EBAY_MARKETPLACE_ID`/`EBAY_CATEGORY_TREE_ID` this has no sensible
  cross-tenant default (it's seller-account-specific), so it falls back to
  `""` when unset — the tenant's eBay seller account must already have at
  least one inventory location configured via eBay Seller Hub before
  publishing will succeed. There's no in-app UI to create or select one in
  v1.

## Tests

`npx jest dashboard/listings`
