---
name: listings-feature
description: Agent playbook for the eBay listing creation feature (src/app/dashboard/listings) — minimal file set per change type, gotchas around the single-page form's save mutex, the TipTap description editor's Enter guard and AI actions, SKU/offer resumability, Storage bucket RLS, and the AuditEntity type gap.
---

# Listings feature playbook

## Minimal file set per change type

- **New listing field**: add it to
  `DraftFormState` in `_lib/wizardValidation.ts`, add a validator if it's
  required (and chain that validator into `ListingForm.tsx`'s `publishError`
  — a validator nobody chains gates nothing), render the control in the
  right `<Section>` of `ListingForm.tsx` (or extend the step component that
  section renders), add it to `ListingForm.tsx`'s `EMPTY_DRAFT`/
  `toFormState`/`toPayload()`, add the DB column via the
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
- **Changing what a seller-account-specific eBay field is fetched from**
  (business policies, inventory location): add the fetch function to
  `lib/integrations/ebay/publish.ts` using the tenant's own connection
  token (never a global env var — see the merchant-location gotcha below
  for why that broke for every tenant but one), add a
  `GET /api/listings/ebay/<thing>/route.ts` mirroring `locations`/
  `policies`'s shape exactly, add the picker to `PoliciesStep.tsx`, add the
  chosen value to `DraftFormState`/`EbayListingDraft`/the DB column (2
  places rule) and `ListingForm.tsx`'s `EMPTY_DRAFT`/`toFormState`/
  `toPayload`, and validate it in `validatePoliciesStep`.
- **Changing anything about listing images** (upload rules, compression,
  ordering, cleanup): `_components/ImageGrid.tsx` is the only UI, and the
  two pure helpers it composes are `_lib/imageResize.ts` (`compressImage`,
  `ALLOWED_IMAGE_TYPES`, `MAX_UPLOAD_BYTES`, plus the tested `fitWithin`)
  and `_lib/storagePath.ts` (`LISTING_IMAGES_BUCKET`, `buildImagePath`,
  `pathFromPublicUrl`). The cap itself is `MAX_LISTING_IMAGES` in
  `_lib/wizardValidation.ts` (with `validateImagesStep` + its colocated
  test) — put new rules in a helper with a test, not inline in the
  component; the component itself has no test (it is all canvas/Storage/DnD
  side effects).
- **Changing the create/edit form's layout** (a new section, moving a
  control between sections, changing the preview column): `ListingForm.tsx`
  only. It is a single scrolling page — three `<Section>`s ("Item",
  "Listing", "Shipping") inside one `<form id="listing-form">`, with
  `<ListingPreview>` in a `lg:sticky` right column and a sticky bottom
  action bar. There is no step machine, no `STEPS` array and no "Next"
  button any more; anything that reads like one in older notes predates
  2026-09-02. The step components (`SourceStep`, `CategoryStep`,
  `AspectsStep`, `PoliciesStep`) survived the rewrite as plain
  `{ draft, setDraft }` field groups — `DetailsStep.tsx` and
  `ReviewStep.tsx` did not (their content is inline in `ListingForm.tsx`
  and `ListingPreview.tsx` respectively).
- **Changing the description editor** (toolbar buttons, which marks are
  allowed, placeholder): `_components/DescriptionEditor.tsx` only — but if
  you enable a new mark or node, add its tag to `ALLOWED_TAGS` in
  `lib/utils/sanitizeListingHtml.ts` AND to the permitted-tag list in
  `DESCRIBE_SYSTEM_PROMPT` (`lib/ai/prompts.ts`) in the same change.
  Otherwise the sanitizer silently strips whatever the button produces on
  the way to eBay, and the seller sees formatting in the editor that never
  reaches the listing.
- **Changing an AI action in the form** (a new AI button, different request
  payload, different failure copy): the UI is
  `_components/DescriptionEditor.tsx` (describe) /
  `_components/AspectsStep.tsx` (aspects) /
  `components/ui/AiUsageNote.tsx` (usage, shared — also used by
  `dashboard/settings/`, see that feature's `SKILL.md`); the routes are
  `app/api/listings/ai/{describe,aspects,usage}/route.ts` and the
  server-only logic behind them is `lib/ai/` (`client.ts`, `prompts.ts`,
  `quota.ts`, `authGuard.ts`, `errors.ts`). `aiVisible` is computed once in
  `ListingForm.tsx` and passed down — don't recompute it per component
  (except `AiUsageNote`, which is prop-free by design and reads the store
  itself). Nothing in this folder may import `lib/ai/*` directly: it is
  server-only (Anthropic key), and the `guard_edit.py` verifier will deny
  the write.
- **Changing the plan/connection gate**: `_components/BusinessEbayGate.tsx`
  is the single source of truth — used by `page.tsx`, `new/page.tsx`, AND
  `[id]/page.tsx`. Change the copy/condition there, not in any individual
  route file.
- **Changing what's editable on an already-published listing**
  (2026-08-31): everything lives in `EditLiveListing.tsx` +
  `/api/listings/[id]/revise/route.ts` — a completely separate path from
  the create form/`publish.ts`. Add the field to `LiveDetail`/`EbayListingDetail`
  (`lib/integrations/ebay/listings.ts`), thread it through
  `fetchListingDetail`'s `GetItem` parsing and `reviseListing`'s
  `ReviseItem` XML building, add the form control in
  `EditLiveListing.tsx`, and include it in the `revise` route's request
  body and its `ebay_listing_drafts` update. Do NOT add it to the create
  form's `DraftFormState`/`ListingForm.tsx` — that's the create-only path and
  never touches an already-published listing again.
- **Adding a new way to bring listings into `ebay_listing_drafts` from
  outside the create form** (e.g. a different platform's "existing listings"
  import): follow `/api/listings/ebay/sync/route.ts`'s pattern — always
  exclude `origin="app"` rows from any upsert, and scope any reconciliation
  status update (`status: "inactive"`, not a delete — see the gotcha below)
  to the new origin value, never to `origin="app"` at the same time as the
  exclusion's own `origin="app"` rows unless it's the deliberate SECOND,
  separate reconciliation pass the sync route already does. See the gotcha
  below for why this is load-bearing, not just a style preference.
- **Adding a new required-looking field to `ListingForm.tsx` /
  `EditLiveListing.tsx` (or any new create/edit form anywhere in the app)**:
  it MUST follow
  `AGENTS.md`'s "Form conventions" section — real `<form>`, `required` on
  the actual input (not just `<Field required>`'s label), and a computed
  `isFormValid` disabling the submit button. `EditLiveListing.tsx` didn't
  do this until 2026-09-01 (Save Changes stayed clickable with empty
  required fields) — see the gotcha below.

## Gotchas

- **Listings is Business-plan-only, not Pro+Business — CHANGED 2026-08-27,
  and the create/edit routes had no gate at all until the same change.**
  `hasPlatformIntegrations` (Pro + Business) was the original gate on
  `page.tsx` only; it's now `hasMessagingAndListings` (Business only, see
  `lib/utils/planGating.ts`) PLUS a connected-eBay check, applied via
  `_components/BusinessEbayGate.tsx` to **all three** routes. Before this,
  `new/page.tsx`/`[id]/page.tsx` rendered the listing form with no gate
  whatsoever — a Pro tenant, or one with no eBay connection at all, could
  reach it by navigating straight to the URL even though the list
  page's "New Listing" button was correctly hidden from them. Don't
  reintroduce a route that renders `ListingForm` without wrapping it in
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
  consume. `ListingForm.tsx` currently logs listing create/update audit
  entries with `entityType: "sale"` as the closest existing category — **fix
  this** by adding `"listing"` to `AuditEntity` and updating
  `ListingForm.tsx`'s two `writeAuditLog` calls the next time this file is
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
- **Save Draft and Publish have deliberately DIFFERENT validity gates
  (rewritten 2026-09-02 — this gotcha used to say "Save Draft / Publish skip
  the step validators", which is no longer true).** All six validators in
  `_lib/wizardValidation.ts` (`validateSourceStep` … `validatePoliciesStep`,
  including `validateAspectsStep`) now run on **every render** of
  `ListingForm.tsx`, `??`-chained into a single `publishError: string | null`.
  That value does exactly two things: it disables the Publish button, and it
  renders next to it as helper text, so a disabled Publish always says why.
  **Save Draft is not gated by any of them** and must never become gated:
  it is `disabled={saving || publishing}` only. Drafts are explicitly allowed
  to be incomplete — that is the point of a draft — so a Save Draft that can
  always succeed must never render as disabled. This is the reconciliation
  between `AGENTS.md`'s form convention ("a mutating button must never look
  clickable when it can't succeed") and this feature's incomplete-draft
  behaviour: the convention is about a button that *cannot succeed*, and Save
  Draft always can. Two consequences that have NOT changed: (a) a row can
  still be written to `ebay_listing_drafts` with an empty title, blank price
  or no images — the DB has only minimal CHECK constraints (`price >= 0`,
  `quantity >= 1`, `NOT NULL title`); (b) client-side validation is a UX gate,
  not a guarantee — the eBay publish call can still fail server-side (400/502)
  for reasons no local validator models. Don't assume "it saved" implies
  "it's valid to publish", and don't assume "Publish was enabled" implies
  "eBay will accept it."
- **`saveDraft()` is behind an in-flight mutex, and it is load-bearing, not
  defensive tidiness (2026-09-02).** Two independent paths call the same
  "update if there's a row, otherwise insert" logic: the Save Draft / Publish
  buttons, and `ImageGrid.tsx`'s `onDraftCreated()` lazy row creation on the
  first image upload. Before the mutex, a user who started an upload and then
  clicked Save Draft or Publish inside the window before the upload flow's own
  busy state disabled those buttons could have BOTH paths read "no existing
  row yet" and BOTH insert — two `ebay_listing_drafts` rows, with the
  just-uploaded images attached to whichever id resolved last. `ListingForm.tsx`
  closes this with two refs, and you need both:
  - `inFlightSave: useRef<Promise<EbayListingDraft | null> | null>` — the
    public `saveDraft()` is a thin wrapper that returns the *already-running*
    promise if one exists instead of starting a second `performSave()`. Only
    one insert can be issued, and both callers resolve with the same row, so
    `onDraftCreated()` still gets a real id back rather than an error.
  - `existingRowRef: useRef<EbayListingDraft | null>` — `performSave()`
    branches on this ref, **not** on the `existingRow` state. `setExistingRow`
    only lands on the next render, so a save started from a closure captured
    before that render would otherwise still see `null` and insert again —
    the same duplicate-row bug, just sequential rather than concurrent.
    `rememberRow()` writes both, ref first.

  If you add a third caller of the insert path, route it through `saveDraft()`
  — never call `performSave()` directly.
- **Everything lives inside one `<form id="listing-form">`, which changes the
  rules for the field-group components (2026-09-02).** `SourceStep`,
  `CategoryStep`, `AspectsStep` and `PoliciesStep` are no longer rendered on
  their own page; they are inside the listing form's DOM. Three consequences
  that have already bitten and are now fixed in-tree:
  - **Every `<button>` inside them needs an explicit `type="button"`.** The
    HTML default is `type="submit"`, so an untyped Category-search or
    Create-location button would publish the listing.
  - **`Enter` in a text input triggers implicit form submission, and the
    default submit button is Publish** — so without a guard, Enter in Title,
    Price, Quantity, the supplier URL or a required-aspect input would push a
    listing live to eBay from a single keystroke, once `isPublishable` is
    true. The 7-step wizard made that impossible (Publish only existed on the
    Review step); the single-page form has to block it explicitly. The
    `<form>` element in `ListingForm.tsx` carries an `onKeyDown` that
    `preventDefault()`s Enter for everything **except** a `<textarea>` (needs
    Enter for newlines), an `isContentEditable` target (the TipTap
    description editor needs Enter for paragraph breaks — added 2026-09-02,
    see the TipTap gotcha below) and a focused `type="submit"` button
    (standard keyboard activation). Do not remove it, and do not "simplify"
    it into a blanket `preventDefault()` — the three exemptions are
    load-bearing.
    `CategoryStep`'s search box also calls `preventDefault()` on Enter for its
    own reason (run the search instead of submitting); it does **not**
    `stopPropagation()`, so the event still reaches the form-level guard,
    which calls `preventDefault()` a second time. That is harmless —
    `preventDefault()` is idempotent and `handleSearch()` lives only in
    `CategoryStep`'s handler, so nothing double-fires.
  - **`<Field required>` does NOT always mean the control should carry
    `required`.** It does for real listing fields (title, price, quantity,
    condition, source, required aspects, the three policies + location — all
    of which now carry the attribute). It deliberately does NOT for
    `CategoryStep`'s search box (a query, not the stored `category_id`) or
    `PoliciesStep`'s inline create-location fields (they belong to the
    Create-location action, and marking them `required` would block the
    listing form's own submit). Both carry an in-file comment saying so —
    don't "fix" them.
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
- **`createOffer` can 400 with errorId 25751 on a brand-new SKU — fixed
  2026-08-30.** eBay's Inventory API has a documented eventual-consistency
  gap: a successful `createOrReplaceInventoryItem` PUT doesn't guarantee the
  SKU is immediately queryable by `createOffer` — a same-second `createOffer`
  call can fail with `"{sku} could not be found or is not available in the
  system for the marketplace {marketplace}"` purely from propagation lag, not
  a bad payload. This only shows up on a SKU's *first* publish attempt
  (update via `updateOffer` isn't affected, since the offer already exists).
  Fixed in `publish.ts`'s `createOfferWithPropagationRetry` — retries up to 3
  times (1s/2s/3s backoff) specifically when the 400 body's `errorId` is
  25751; any other error in that body fails immediately instead of wasting
  the retry budget on a request that will never succeed (bad category ID,
  missing policy IDs, etc.). Don't bypass this by calling
  `ebayFetch("/sell/inventory/v1/offer", ...)` directly for a new offer.
- **`pathFromPublicUrl` returning `null` means "remove only, delete
  nothing" — never treat it as a failure to work around (2026-09-01).**
  `_lib/storagePath.ts`'s `pathFromPublicUrl` validates the URL's *hostname*
  (`*.supabase.co`) before matching the bucket marker, and returns `null` for
  anything else. That is not an edge case: every listing brought in by `POST
  /api/listings/ebay/sync` holds eBay CDN URLs (`i.ebayimg.com`), and those
  images belong to eBay, not to this app. `ImageGrid.tsx`'s `removeImage`
  therefore drops the URL from `draft.image_urls` and returns early on
  `null` — a caller that instead fell back to "parse the path out anyway"
  would issue storage deletes against objects this app does not own. Any new
  code path that removes a listing image (bulk delete, a listing-delete
  cleanup job, anything) must reuse `pathFromPublicUrl` and honour the
  `null` branch. The delete itself is also deliberately fire-and-forget:
  the array is updated first, and a failed `remove()` only `console.warn`s —
  a Storage hiccup must never block a seller from editing their listing.
- **The draft row is created lazily on the first image upload — that is not
  autosave (2026-09-01).** `ImageGrid.tsx` needs a real draft id to build a
  storage path (`{tenant_schema}/{draftId}/{uuid}.{ext}` — the RLS-critical
  shape, see the bucket gotcha below), so when `draftId` is `null` it awaits
  `onDraftCreated()`, which `ListingForm.tsx` wires to `handleDraftCreated()`
  → the same `saveDraft()` insert path Save Draft uses (which is exactly why
  that path needs the in-flight mutex — see the gotcha below). This replaced the old
  `"unsaved"` folder, whose orphaned files nothing ever cleaned up. Two
  consequences to keep in mind: (a) a row now exists in `ebay_listing_drafts`
  as soon as someone uploads an image, even if they never click Save Draft —
  it is a `status="draft"` row with whatever fields were filled at that
  moment; (b) **nothing after that point autosaves** — the id is reused for
  subsequent uploads, but title/price/policy edits made later still only
  reach the DB when the user clicks Save Draft or Publish, and so do the
  image URLs and their ORDER (drag-reorder only mutates local form state).
  Don't read "the draft got created" as "the draft is up to date."
- **The 24-image cap lives in two places on purpose.** `MAX_LISTING_IMAGES`
  (`_lib/wizardValidation.ts`) is enforced by `validateImagesStep` (which
  gates the Publish button) *and* by `ImageGrid.tsx`'s picker, which refuses the
  files that would cross the cap rather than uploading them and failing
  validation afterwards. Change the constant, not either call site — and if
  you add another way to add images (a URL paste box, an AI-generated
  image), enforce it there too: eBay rejects the publish outright past 24.
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
- **Merchant location is per-tenant, fetched live — fixed 2026-08-30, was a
  global env var before.** Every eBay Offer must reference a
  `merchantLocationKey` pointing at an existing inventory location in the
  seller's own eBay account, or `publishOffer` fails with errorId 25002
  ("no Item.Country exists") — a location has no country to build the
  listing from otherwise. This used to be a single `EBAY_MERCHANT_LOCATION_KEY`
  env var, which is seller-account-specific and therefore could only ever
  be correct for one tenant — every other tenant's publish would fail the
  same way. Confirmed live 2026-08-30 against `tenant_kaufnest`'s first real
  publish attempt. Fixed the same way business policies already work:
  `fetchInventoryLocations` (`publish.ts`) calls `GET
  /sell/inventory/v1/location` with the tenant's own token (`sell.inventory`
  scope, already granted — no reconnect needed), `PoliciesStep.tsx` lets the
  tenant pick one (auto-selected if they have exactly one usable location),
  and the choice is stored on `ebay_listing_drafts.merchant_location_key`
  (migration `036`). Locations missing a `country` are filtered out of the
  picker entirely — offering one would just reproduce this same bug.
- **Location creation is in-app now (2026-08-31), but `country` is never
  auto-filled — deliberately.** When a tenant has zero usable locations,
  `PoliciesStep.tsx` shows an inline create form (POST to the same
  `/api/listings/ebay/locations` route, `createInventoryLocation` in
  `publish.ts`) instead of sending them to Seller Hub. `locationTypes:
  ["WAREHOUSE"]` is hardcoded (needs only city + country, no full street
  address, per eBay's location-type rules) and `merchantLocationKey` is
  generated the same way `generateListingSku()` is (alphanumeric-only,
  `LOC` + 12 chars — same "avoid an eBay-account-wide bad-format failure"
  rationale). The tempting shortcut — auto-filling `country` from
  `company_profile` — was rejected on purpose: `company_profile.address` is
  a single freeform text column with no structured `country` field, so any
  auto-fill would be a guess, and a wrong guess here wouldn't error, it'd
  silently create a listing targeted at the wrong country — a worse,
  harder-to-notice version of the exact bug this whole feature exists to
  prevent. The tenant always types `country` themselves.
- **Required item aspects (Brand, etc.) are category-specific — fixed
  2026-08-31.** `publishOffer` can 400 with errorId 25002 for a missing
  required aspect (e.g. "Das Artikelmerkmal Marke fehlt" — the aspect name
  is localized to whatever `Content-Language` this app sends, so "Brand" on
  EBAY_US is "Marke" on EBAY_DE), one missing aspect at a time, confirmed
  live 2026-08-31 on "Vitamine & Mineralien". There's no fixed list — every
  category has its own required-aspect set, only knowable via eBay's
  Taxonomy API. Fixed with `AspectsStep.tsx` (a field group rendered in
  `ListingForm.tsx`'s "Listing" section, right under the category picker;
  it was a separate wizard step before 2026-09-02) that fetches
  `fetchRequiredAspects(categoryId)` (`publish.ts`, Taxonomy API
  `get_item_aspects_for_category`, application token like
  `searchCategories` — category metadata isn't seller-specific) whenever
  `draft.category_id` changes, and renders a Select (if eBay returned
  suggested values) or free-text Input per required aspect. Stored on
  `ebay_listing_drafts.aspects` (migration `037`, `jsonb`, flat
  `name -> value` map — this app doesn't support eBay's MULTI-cardinality
  aspects in v1) and sent as `product.aspects` in
  `buildInventoryItemPayload`, each value wrapped in a single-element array
  per eBay's schema. If you add a new required-field-fetching step like
  this one, see the gotcha above about `merchant_location_key` for the
  general "fetch live from eBay, never guess" pattern this now follows
  twice.
- **Product identifiers (EAN/UPC/ISBN/GTIN/MPN) are a separate class from
  ordinary aspects, and eBay's Taxonomy API under-reports them as
  "required" — fixed 2026-08-31, same day as the Brand fix above.** After
  Brand was fixed, the *same* draft still failed identically at
  `publishOffer` with errorId 25002, this time for EAN — proof it wasn't a
  timing issue, it was a second, structurally different gap. eBay's own
  docs: many categories need at least one product identifier (a GTIN, or a
  Brand+MPN pair) — a documented, *separate* requirement from generic
  aspects — but the Taxonomy API commonly reports these as `aspectUsage:
  "RECOMMENDED"` rather than `aspectRequired: true`, even though
  `publishOffer` treats them as mandatory. `fetchRequiredAspects` now also
  includes any aspect whose name matches a fixed, known set (`ean`, `upc`,
  `isbn`, `gtin`, `mpn` — case-insensitive, see `PRODUCT_IDENTIFIER_NAMES`
  in `publish.ts`) regardless of what `aspectRequired`/`aspectUsage` say,
  rather than loosening the filter to "everything not explicitly OPTIONAL"
  (which would flood every category's step with cosmetic aspects like
  Color/Style/Material that genuinely are optional). Each `RequiredAspect`
  now carries an `isProductIdentifier` flag; `AspectsStep.tsx` uses it to
  show a "This product doesn't have a {name}" checkbox next to that field,
  which fills in eBay's own sanctioned placeholder text instead of leaving
  it blank — `getProductIdentifierNotApplicableText()` (`publish.ts`) is
  marketplace-specific ("Does not apply" on English sites, "Nicht
  zutreffend" on EBAY_DE/AT, etc. — sending the wrong site's text is
  silently treated as an invalid real identifier, not recognized as "N/A").
  **This is a finite, named list, not a general "when in doubt, include it"
  rule** — if a *third* category of quiet-failure field turns up beyond
  aspects and identifiers, add it as its own recognized case here rather
  than broadening the filter further; the goal is closing named gaps eBay
  documents, not guessing at every possible one.
- **Sync must never overwrite an `origin="app"` row — load-bearing, not a
  style choice (2026-08-31).** `POST /api/listings/ebay/sync` upserts by
  `ebay_listing_id`, which is a full (non-partial) unique index across the
  WHOLE table, not scoped by `origin`. `GetMyeBaySelling`'s summary (what
  the sync fetches) carries none of a listing's `aspects`/policies/
  `merchant_location_key` — if the upsert ever ran against an app-published
  listing that's still active on eBay, it would silently blank all of that.
  The route protects this by reading every existing `origin="app"` row's
  `ebay_listing_id` first and excluding those from the upsert batch,
  BEFORE building the insert rows — not as a post-hoc filter on the
  result. If you ever add a second sync source (a different platform, a
  scheduled job, anything else that writes `ebay_listing_drafts` from
  external data), it must do the same exclusion; there is nothing at the
  DB layer stopping a naive upsert from wiping an app-created listing.
- **"Never touch `origin="app"`" applies to the upsert, not to reconciliation
  — these are two different operations with different rules (2026-09-01).**
  Confirmed live: a tenant's own published listing was ended outside this
  app (Seller Hub, or a duplicate Delete click hitting eBay errorCode 1047,
  "The auction has already been closed") and stayed `status="published"`
  forever, since Sync's reconciliation was originally scoped to
  `origin="ebay_import"` only — the same scoping that correctly protects
  `origin="app"` rows from the upsert was accidentally also protecting them
  from ever being corrected. Fixed by adding a SECOND reconciliation pass,
  scoped to `origin="app"` AND `ebay_listing_id` in the already-fetched
  `appOwnedIds` set (no second query) AND not present in eBay's fresh active
  list — this only ever fires for a row that's actually a full match on
  `ebay_listing_id`, never a blind overwrite, so it doesn't reintroduce the
  data-loss risk the upsert exclusion exists to prevent. The `end` route
  also treats eBay errorCode 1047 specifically as success (not a 502) for
  the same reason — clicking Delete on an already-ended listing should
  still mark the local row inactive, not leave it stale with an error toast.
- **Reconciliation marks `status: "inactive"`, it does not delete
  (2026-09-01 — a later change from the original design above, which did
  delete).** `end`, both of `sync`'s reconciliation branches, and
  `ebay-detail`'s self-correction all used to `.delete()` the local row once
  a listing was confirmed gone from eBay — the user asked for this to
  preserve history instead, so a tenant deleting a listing (or eBay ending
  one behind their back) still shows up under the Listings page's
  "Inactive" filter rather than vanishing. All three now
  `.update({ status: "inactive" })` instead (migration
  `039_ebay_listing_drafts_inactive_status.sql` adds `"inactive"` to the
  `status` CHECK constraint, mirrored into `provision_tenant_schema()`).
  `end`'s response shape changed from `{ ok: true }` to the updated
  `EbayListingDraft` row (or `{ ok: true }` as a fallback if the status
  update itself failed — same "display-only inconsistency, Sync corrects it
  later" reasoning the original delete-failure handling used) — if you add
  a new caller of `POST /api/listings/[id]/end`, don't assume `{ ok: true }`
  is the only possible success shape. `sync`'s response key also renamed
  `removed` → `deactivated` — a client reading the old key name will read
  `undefined` and silently show "undefined removed" in a toast.
- **Multi-value aspects are also silently destroyed on the WRITE side, not
  just collapsed on read (2026-08-31 final review, mitigated not fixed).**
  `fetchListingDetail`'s read-side collapse (see the test above) was an
  accepted v1 limitation for reading, but it is NOT symmetric for writing:
  if a real eBay listing has `Color: Red, Blue` and a tenant edits ANY field
  in `EditLiveListing.tsx` (even just price), the `aspects` state only ever
  held `{ Color: "Red" }` — that's all `fetchListingDetail` gave it — so on
  Save, `reviseListing` sends `<NameValueList><Name>Color</Name><Value>Red</Value></NameValueList>`.
  `ReviseItem`'s `ItemSpecifics` is replace-all, so eBay now believes Color's
  only value is Red — "Blue" is gone from the live listing permanently, even
  though the tenant never touched Color. `fetchListingDetail` now also
  returns `multiValueAspectNames: string[]` (names of any aspect eBay
  reported with >1 `<Value>`), and `EditLiveListing.tsx` renders a warning
  next to any *required* (visible) field whose name appears there — but this
  is a UI warning only, not a guard: nothing stops the save, and an aspect
  that isn't in the category's required-aspect list is never rendered as a
  field at all, so a multi-value aspect outside that list gets no warning
  either, even though it's silently collapsed the same way. A full fix means
  redesigning `EbayListingDetail`/`ReviseListingInput`'s `aspects` shape from
  `Record<string, string>` to something multi-value-aware end-to-end (fetch,
  diff in `buildAspectsForRevise`, the UI, and the `ReviseItem` XML builder)
  — that's a properly-scoped follow-up task, not done here. Don't mistake the
  warning for the fix.
- **`revise`'s `ItemSpecifics` omission depends on the frontend never
  submitting stale/empty aspects (2026-08-31) — the two halves of this
  contract live in different files and must be kept in sync.**
  `POST /api/listings/[id]/revise` calls `buildAspectsForRevise(current,
  submitted)` — `current` comes from a FRESH `fetchListingDetail` call the
  route makes itself (never trusting anything the client claims is "the
  original"), and if `submitted` matches it exactly, `aspects` is omitted
  from the `ReviseItem` call entirely (per eBay's own guidance: resending
  unchanged `ItemSpecifics` risks "attribute version problems"). This is
  only safe because `EditLiveListing.tsx` seeds its `aspects` state from
  `ebay-detail`'s response on load and only ever merges into it
  (`setAspects(prev => ({ ...prev, [name]: value }))`), never resets it to
  `{}`. If a future edit to `EditLiveListing.tsx` ever submits `aspects` as
  empty or omitted for a listing that genuinely has aspect values, the
  route would interpret that as "clear all specifics" and send an empty
  `<ItemSpecifics>` block, wiping real eBay listing data. Don't "simplify"
  the aspects state handling in that file without re-reading this gotcha
  first.

- **`listingStatus` defaults to `"Active"` on purpose — never flip that
  default without re-checking the reconciliation logic it feeds (2026-09-01).**
  `fetchListingDetail` reads `SellingStatus.ListingStatus` and falls back to
  `"Active"` if the tag is absent: `tagText(sellingStatus, "ListingStatus")
  ?? "Active"`. `GET /api/listings/[id]/ebay-detail` treats any non-`"Active"`
  value as "this listing ended on eBay" and marks the local row `inactive`.
  The fail-safe direction matters: if eBay ever omitted the tag on a
  genuinely active listing, defaulting to anything OTHER than `"Active"`
  would mark a live, still-selling listing inactive on the next page load.
  Defaulting to `"Active"` means the worst case of a missing tag is
  staleness lingering one more Sync cycle, not a live listing wrongly
  hidden from its own edit page.
- **`EditLiveListing.tsx`'s Save button used to stay clickable with empty
  required fields (found and fixed 2026-09-01) — any new form in this app
  must not repeat it.** The page had no `<form>` element at all (a bare
  `<div>`, Save was `type="button" onClick={handleSave}`) and none of its
  `<Field required>`-marked inputs carried an actual `required` attribute
  — `<Field required>` only draws the visual asterisk, it does not
  propagate the attribute to the `<Input>`/`<Select>`/`<Textarea>` inside
  it. Fixed to match every other Add/Edit form in the app: real
  `<form id="edit-live-listing-form" onSubmit={handleSave}>`, `required` on
  every actual control (including `required={!isNotApplicable}` on the
  product-identifier "doesn't apply" case, and on both branches of the
  generic required-aspect field), Save changed to
  `type="submit" form="edit-live-listing-form" disabled={saving ||
  !isFormValid}` with `isFormValid` computed inline from `detail`/
  `imageUrlsText`/`aspects`. See `AGENTS.md` → "Form conventions" for the
  full checklist this now follows — apply it to any NEW form, don't wait
  for a bug report to retrofit it.

- **Description HTML is sanitized in `publishPayloads.ts`, not in the
  description editor — the client is not a security boundary here
  (2026-09-01).**
  `ebay_listing_drafts.description` is written straight to Supabase from the
  browser (no server API in between), so any client-side editor restriction
  is cosmetic — a direct Supabase write bypasses it entirely.
  `lib/utils/sanitizeListingHtml.ts` (`isomorphic-dompurify`, a small
  allowlist of formatting tags/attrs + `https?://`-only URLs) is the actual
  enforcement point, called from both places `publishPayloads.ts` builds an
  eBay-bound description: `buildInventoryItemPayload`'s `product.description`
  and `buildOfferPayload`'s `listingDescription` (whose title-fallback check
  changed from `draft.description ?? draft.title` to a truthiness check, so
  a description that sanitizes down to nothing — e.g. pure `<script>`
  content — still falls back to the title instead of publishing empty).
  **`isomorphic-dompurify` is pinned to `2.17.0` in `package.json`, not
  latest** — `3.x`/`4.x` pull in `jsdom@28+`, whose `html-encoding-sniffer`
  dependency ships an ESM-only `@exodus/bytes` file that this project's
  `ts-jest` config (no `transformIgnorePatterns` override) can't transform,
  so any test that imports the sanitizer fails with `SyntaxError: Unexpected
  token 'export'` at collection time. `2.17.0` depends on `jsdom@^25.0.1`,
  which still resolves `html-encoding-sniffer@^4` (no ESM-only sub-dep) and
  runs fine under the default jest config. Don't bump this package without
  re-checking that chain.

- **TipTap's contenteditable is not a `<textarea>`, and the form's Enter
  guard is written in terms of `tagName` (2026-09-02).** Replacing the plain
  `<Textarea>` with `DescriptionEditor.tsx` took the description field out of
  the `tagName === "TEXTAREA"` exemption in `ListingForm.tsx`'s `onKeyDown`
  — the same guard that exists to stop Enter from publishing a listing to a
  live marketplace. The fix is two-layered on purpose:
  1. **`DescriptionEditor.tsx` calls `event.stopPropagation()` on Enter**
     inside `editorProps.handleKeyDown` and returns `false`. React attaches
     its listeners at the root container, so stopping the native event on
     ProseMirror's own `contenteditable` node means the form-level handler
     never runs at all. Returning `false` is what keeps Enter working:
     prosemirror-view's `someProp` consults this direct prop FIRST and only
     falls through to the keymap plugins (paragraph split, list-item split)
     on a falsy return. Returning `true` would swallow Enter entirely.
  2. **`ListingForm.tsx` also exempts `target.isContentEditable`.** Belt and
     braces for the iOS path, where prosemirror-view defers Enter to a
     `setTimeout` with a *synthetic* key event and lets the real one bubble
     untouched — layer 1 never sees that one. A contenteditable is not a
     form control and cannot trigger implicit submission itself, so this
     exemption gives nothing away.
  Do not "consolidate" these into one. Do not swap `stopPropagation()` for
  `preventDefault()` in layer 1 — that would kill the paragraph break.
- **AI controls are HIDDEN when unavailable, not disabled-with-a-tooltip —
  but the routes still enforce it.** `aiVisible = !!tenantPlan &&
  hasAiFeatures(tenantPlan) && aiEnabled` (computed in `ListingForm.tsx`,
  passed down; `AiUsageNote` recomputes it for itself). When it is false the
  buttons and the usage note are not rendered at all — a greyed-out "Write
  with AI" advertises a feature the tenant's plan does not include. Hidden
  chrome is presentation only: `lib/ai/authGuard.ts` (`requireAiAccess`) is
  the real gate and re-checks plan, tenant flag, `manage_listings` and quota
  on every call. **Quota exhaustion is the deliberate exception**: a `429`
  leaves the buttons rendered but `disabled`, with the route's own message
  (which quotes the real monthly limit) shown next to them — the tenant has
  the feature, they have just used it up, and hiding it would look like a
  bug. `GET /api/listings/ai/usage` is deliberately NOT behind
  `requireAiAccess` for the same reason: it must keep answering at 100% used.
- **`max_tokens` on the AI routes is a combined thinking + output budget, and
  both routes branch on `stop_reason === "max_tokens"`.** Neither route passes
  a `thinking` parameter, and on `claude-opus-5` (`AI_MODEL`) omitting it runs
  **adaptive thinking by default** — the opposite of Opus 4.8/4.7, where
  omitting it meant no thinking. So reasoning eats into the same `max_tokens`
  the response text has to fit in. `aspects/route.ts` was raised 1000 → 4000
  for this (a JSON object derived from up to 4 images); `describe/route.ts`
  stays at 4000. Both now return a distinct "the AI response was cut off"
  error on truncation instead of letting a half-written response fall through
  to a generic parse failure or a silently-repaired half-sentence description.
  If you ever want to reclaim the thinking budget, `thinking: { type:
  "disabled" }` is only legal at effort `high` or below — both routes run at
  `AI_EFFORT = "low"`, so it is available, but measure before assuming it
  helps.
- **A `recordUsage` failure must never destroy a generated AI response.**
  Both AI routes wrap the `recordUsage` call in its own try/catch that
  `console.error`s and continues. It sits *after* a successful Anthropic
  call, so letting it reach the route's outer catch would return a 502 and
  discard content the tenant has already been billed for. Metering is
  bookkeeping; the same "log and don't block the user" rule as `ImageGrid`'s
  failed storage cleanup applies.
- **Every AI route and the AI guard return `aiErrorMessage(err)` — never raw
  error text.** `src/lib/ai/errors.ts` maps provider/driver failures to copy
  a seller can act on; the real cause goes to `console.error` server-side.
  `requireAiAccess`'s own catch used to return `{ error, detail:
  errorMessage(err) }`, which leaked Postgres text, `readTenantUsage`'s
  message, and `createControlClient()`'s missing-env-var throw to **any**
  tenant user holding `manage_listings` (fixed 2026-09-03; `usage/route.ts`
  had already been fixed the same way earlier in the same plan). There is no
  `detail` field in any AI response body — don't reintroduce one.
- **An empty aspect value from the model means "could not determine" and must
  never be merged.** `AspectsStep.tsx`'s Fill-with-AI skips any returned
  value that trims to empty. Writing `""` back would be indistinguishable
  from a confident answer, and worse, it makes a still-unanswered required
  field look dealt with right up until eBay rejects `publishOffer` with
  errorId 25002. Two sibling rules in the same merge loop: a value that
  isn't in a closed-list aspect's `values` is also skipped (the `<Select>`
  would render blank while `draft.aspects` held something eBay will reject),
  and a field the seller already filled in is never overwritten — only
  blanks and the component's own previous AI answers are. The "AI" badge
  tracks exactly that last set (`aiFilled`, local state, never persisted);
  it clears on the field's next `onChange`, because once the seller edits a
  value it is theirs.
- **`/api/listings/ai/describe` is deliberately non-streaming.** Streaming
  the HTML into the editor token-by-token would mean rendering a partial,
  unsanitized document — and `sanitizeListingHtml` needs a *complete* one to
  make a correct allowlist decision (a half-arrived `<script` isn't a tag
  yet). The route waits for the full response, sanitizes it, and returns
  `{ html }`; the editor calls `setContent` once, only on success, so a
  failed call can never leave a half-written description behind. Don't
  "improve" this into a stream.
- **A stored description is not necessarily HTML — run it through
  `toEditorHtml` before it reaches the editor.** `ebay_listing_drafts.
  description` is a plain `text` column that predates the rich editor (the
  design chose "wrap legacy plain text in `<p>` on load" over a schema
  fan-out), so real rows in the live database still hold `\n`-separated plain
  text. TipTap parses `content` as HTML, so handing it that string collapses
  the whole thing into one whitespace-normalized paragraph and the seller's
  line breaks are gone. `_lib/descriptionHtml.ts` escapes and wraps legacy
  text (`\n\n` → paragraphs, `\n` → `<br>`) and passes anything already
  HTML through untouched; `ListingForm.tsx`'s `toFormState` is the single
  call site. Escaping first is load-bearing — a legacy description containing
  `<` or `&` must render as those characters, not be reinterpreted as markup.
- **`useEditor` re-diffs its whole options object on every render**
  (`EditorInstanceManager.compareOptions` in `@tiptap/react`) and calls
  `editor.setOptions()` — which re-runs `view.setProps()` +
  `view.updateState()` — on any identity mismatch. So `EXTENSIONS` and
  `EDITOR_PROPS` in `DescriptionEditor.tsx` are module-level constants: an
  inline `StarterKit.configure({...})` or `editorProps` literal is a new
  object every keystroke. `content` is likewise pinned to a `useRef` of the
  first `value` — `setOptions` never re-parses `content`, so passing the
  live value there would churn the view for nothing. External value changes
  are pushed in by an explicit effect that skips while the editor is focused
  and passes `{ emitUpdate: false }`, so it can never fight the cursor or
  echo back out as a change. Empty is normalized: `onUpdate` emits `""`
  rather than ProseMirror's `"<p></p>"`, so `draft.description` stays falsy
  for the preview's empty state, `scoreListing` and `toPayload()`'s
  `|| null`.

## Tests

`npx jest dashboard/listings` and `npx jest lib/integrations/ebay/listings`
(the Trading API functions this feature added — `fetchListingDetail`,
`reviseListing`, `endListing`, `buildAspectsForRevise`,
`conditionIdToListingCondition`). `npx jest lib/utils/sanitizeListingHtml`
and `npx jest lib/integrations/ebay/publishPayloads` cover the description
sanitization above. `npx jest lib/ai` covers the prompt builders and quota
accounting behind the AI routes.

`DescriptionEditor.tsx`, `AiUsageNote.tsx` and `AspectsStep.tsx`'s AI fill
have **no automated tests** and that is not an oversight: this repo's
`jest.config.ts` uses `testEnvironment: "node"` with no jsdom, so no
component in this folder can be rendered in a test at all (same reason
`ListingPreview.tsx` and `ImageGrid.tsx` have none). TipTap additionally
needs a real DOM to instantiate. Put anything worth asserting in a pure
helper — `_lib/` — where it can be tested; verify the components in the
browser.
