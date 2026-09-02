# Listings feature

Route: `/dashboard/listings`, `/dashboard/listings/new`, `/dashboard/listings/[id]`,
`/dashboard/listings/[id]/live`.
Lets an admin/super_admin build an eBay listing from an Inventory item or a
third-party (dropship) source, save it as a draft, and publish it to eBay via
the eBay Inventory API. Gated on the **Business plan** (not Pro — changed
2026-08-27, see `_components/BusinessEbayGate.tsx`) **and** a connected eBay
account, applied to all four routes, plus a dedicated `manage_listings`
permission (admin/super_admin only — nav entry is visible to all roles, but
Save Draft/Publish/category-search/policy-fetch/Sync/live-edit/Delete all
require the permission).

**Two-part feature, both parts now built (2026-08-31).** Part 1 is the
create/publish form described below (Inventory API — a 7-step wizard until
2026-09-02, now a single scrolling page, see `ListingForm.tsx`). Part
2 is syncing in a tenant's full eBay listing history (including listings this
app never created) and editing/ending any of them via the Trading API — see
"Sync & live-edit flow" below. `docs/superpowers/specs/2026-07-20-ebay-listing-creation-design.md`
covers only Part 1; Part 2's design is
`docs/superpowers/specs/2026-08-31-ebay-listing-sync-edit-design.md`.

## Files in this folder

- `page.tsx` — paginated listings table (`fetchListingsPage` thunk, same
  pagination architecture as Sales/Purchases/Expenses). "New Listing" and
  "Sync from eBay" (2026-08-31 — `POST /api/listings/ebay/sync`, then
  re-fetches page 1) buttons, both gated on `manage_listings`. A Status
  filter dropdown (2026-09-01 — `STATUS_FILTER_OPTIONS`, a plain `Select`
  next to the header, not the shared `FilterBar` — a single dropdown didn't
  need FilterBar's date/currency/search machinery) defaults to "Active"
  (`status="published"`) and pushes into the fetch thunk's `status` param
  server-side; see "Data flow" below for why this page needs one extra
  mount-effect fetch that Sales/Expenses/Purchases don't. Wrapped in
  `_components/BusinessEbayGate.tsx` for the plan/connection gate (see
  below) — `page.tsx` itself no longer reads `tenantPlan`/`connections`
  directly.
- `new/page.tsx` / `[id]/page.tsx` — thin client-component wrappers around
  `_components/ListingForm.tsx` (draftId `null` vs the route param, read via
  React's `use(params)`), each also wrapped in `_components/BusinessEbayGate.tsx`
  — added 2026-08-27; these two routes previously had no gate at all, so a
  Pro tenant or a tenant with no eBay connection could reach the form
  directly by URL even with the list page's button correctly hidden.
- `_components/BusinessEbayGate.tsx` — the plan/connection gate itself
  (2026-08-27): renders an upgrade prompt when `tenantPlan` isn't Business
  (`hasMessagingAndListings`, `lib/utils/planGating.ts`), an "eBay connection
  required" prompt when `state.integrations.connections` has no `platform:
  "ebay"` row with `status === "connected"`, or `children` otherwise. Used by
  all three route files above — change the gate condition/copy here, not
  per-route.
- `_components/ListingForm.tsx` (2026-09-02, replaced `ListingWizard.tsx`) —
  the create/edit form. Owns `draft` (`DraftFormState`, all-string
  controlled-input state), loads an existing draft row when `draftId` is
  set, and handles Save Draft (direct Supabase insert/update via
  `toPayload()` + audit log) and Publish (saves, then
  `POST /api/listings/[id]/publish`).
  **Layout**: a two-column grid (`lg:grid-cols-[1fr_380px]`, single column
  below `lg`). The left column is ONE `<form id="listing-form"
  onSubmit={handlePublish}>` holding three `<Section>`s — **Item**
  (`SourceStep`, title, `DescriptionEditor` + `AiUsageNote`, `ImageGrid`),
  **Listing**
  (`CategoryStep`, `AspectsStep`, price / currency / quantity / condition)
  and **Shipping** (`PoliciesStep`). The right column is
  `<ListingPreview draft={draft} />` in a `lg:sticky lg:top-6` wrapper, so
  the preview and its quality meter track every keystroke. Below the grid
  is a `sticky bottom-0` action bar holding Save Draft and Publish; the
  Publish button lives outside the `<form>` and reaches it via
  `type="submit" form="listing-form"`. There is no step state, no `STEPS`
  array and no Next/Back — that was the pre-2026-09-02 wizard.
  **The `<form>` blocks implicit Enter submission** via its own `onKeyDown`
  (exempting `<textarea>`, any `isContentEditable` target, and a focused
  submit button): Publish is the
  default submit button, so Enter in Title/Price/Quantity/an aspect field
  would otherwise publish to a live eBay marketplace from one keystroke —
  a hazard the old step-gated wizard didn't have. See `SKILL.md`.
  **It also owns `aiVisible`** (2026-09-02) — `!!tenantPlan &&
  hasAiFeatures(tenantPlan) && aiEnabled`, read from `currentUserSlice` —
  and passes it down to `DescriptionEditor` and `AspectsStep`, plus an
  `onAiUsed` callback that bumps an `aiUsageToken` counter so
  `<AiUsageNote refreshToken={…} />` re-reads usage after each AI call.
  **Button gates** (deliberately asymmetric, see `SKILL.md`): all six
  `_lib/wizardValidation.ts` validators are `??`-chained every render into
  `publishError`, which disables Publish and renders beside it as the
  explanation; Save Draft is disabled only while a save/publish is in
  flight, never by field completeness, because incomplete drafts are a
  supported state.
  **Two refs guard the row-creation race** (`inFlightSave`,
  `existingRowRef`) — `ImageGrid`'s lazy `onDraftCreated()` and the two
  buttons all funnel through one mutexed `saveDraft()`; see `SKILL.md`'s
  gotcha for the duplicate-row bug this closes.
  `toPayload()` builds the DB row shape shared by insert/update; `created_by`
  is set only on the insert path (`{ ...toPayload(), created_by: user.id }`),
  never on update — this file's predecessor had a bug where update also
  overwrote `created_by`, since fixed. On load, `status === "published"`
  redirects to the live-edit page and `status === "inactive"` (2026-09-01)
  redirects back to `/dashboard/listings` with a toast — this form has no
  re-publish flow, so a direct URL hit on an ended listing's `[id]` route
  bounces out instead of rendering an editable-looking form for a listing
  that's actually gone.
- `_components/{Source,Category,Aspects,Policies}Step.tsx` —
  field groups rendered by `ListingForm.tsx`'s sections, each taking
  `{ draft, setDraft }`. (`DetailsStep.tsx` and `ReviewStep.tsx` were
  deleted in the 2026-09-02 rewrite — their content is now inline in
  `ListingForm.tsx` and `ListingPreview.tsx` respectively.) Images are
  `_components/ImageGrid.tsx` (2026-09-01, replaced `ImagesStep.tsx`) —
  see its own entry below. Because they now live inside a real `<form>`,
  every `<button>` in them carries an explicit `type="button"`,
  `CategoryStep`'s search box `preventDefault()`s Enter (to run its search
  rather than submit), and real listing fields carry a `required` attribute
  (but NOT `CategoryStep`'s search query or `PoliciesStep`'s create-location
  sub-form — see `SKILL.md`).
  `AspectsStep`
  also takes optional `{ aiVisible, onAiUsed }` (2026-09-02): with
  `aiVisible` it renders a **Fill with AI** button above the fields which
  `POST`s title/description/`image_urls`/the required-aspect names to
  `/api/listings/ai/aspects` and merges the answer into `draft.aspects`.
  Three merge rules, all deliberate: an empty returned value is skipped
  ("could not determine", never written back), a value outside a
  closed-list aspect's `values` is skipped (the `<Select>` would show blank
  while the draft held an invalid value), and a field the seller already
  filled in is never overwritten — only blanks and the component's own
  previous AI answers are. Filled names go into local `aiFilled` state and
  render a small "AI" badge that clears on that field's next `onChange`
  (and on a category change, which reloads the whole aspect set). It
  (2026-08-31) fetches `/api/listings/ebay/aspects?categoryId=` whenever
  `draft.category_id` changes, and renders one field per item aspect eBay's
  Taxonomy API says is required for that category (e.g. Brand/"Marke") —
  `publishOffer` otherwise rejects with errorId 25002 one missing aspect at
  a time. Stores the fetched required-names list on
  `draft.required_aspect_names` (form-only, never persisted — see
  `wizardValidation.ts`) so `validateAspectsStep` can check completeness
  without re-fetching. `PoliciesStep`
  fetches `/api/listings/ebay/policies` AND `/api/listings/ebay/locations`
  on mount (in parallel) — the latter lets the tenant pick their own eBay
  inventory location (`merchant_location_key`), auto-selected when they have
  exactly one usable (has a country set) location. If they have zero, an
  inline form (name/city/state/postal/country) posts to the same
  `/api/listings/ebay/locations` route to create one via eBay's
  `createInventoryLocation`, instead of sending them to Seller Hub —
  `country` is always typed by the tenant, never guessed from
  `company_profile` (see `SKILL.md`'s gotcha for why). `CategoryStep` hits
  `/api/listings/ebay/categories?q=` on explicit Search-button/Enter (not
  live-as-you-type) and lets the user pick a suggestion.
- `_components/DescriptionEditor.tsx` (2026-09-02) — the description field.
  A TipTap (`@tiptap/react` + `@tiptap/starter-kit`) rich-text editor that
  replaced the plain `<Textarea>`; props `{ value, onChange, draft,
  aiVisible, onAiUsed }`. Emits `editor.getHTML()` (normalized to `""` when
  `editor.isEmpty`, so an empty doc never persists as `"<p></p>"`), which
  `ListingPreview` already renders through `sanitizeListingHtml`.
  `StarterKit` is configured down to exactly what the sanitizer's allowlist
  keeps AND the toolbar can produce — bold, italic, bullet/ordered list, H2,
  H3; `blockquote`/`code`/`codeBlock`/`horizontalRule`/`strike`/`link` are
  off. The extensions array and `editorProps` are module-level constants on
  purpose (see `SKILL.md`'s gotcha on `useEditor`'s per-render option diff).
  When `aiVisible`, renders **Write with AI** and (only with existing
  content) **Improve with AI**, both `POST /api/listings/ai/describe` and
  replace the document via `editor.commands.setContent(html)` on success
  only — a failed call leaves the editor untouched. A `429` keeps the
  buttons rendered but disabled with the route's quota message.
- `_components/AiUsageNote.tsx` (2026-09-02) — one-line current-period AI
  usage read from `GET /api/listings/ai/usage`, plus a per-user breakdown
  when the route returns `perUser` (admin/super_admin only — the route
  decides, this component just renders what it gets). Computes `aiVisible`
  itself from `currentUserSlice` and renders `null` when false or before
  the fetch resolves; a failed fetch is swallowed on purpose (usage is
  informational and must never toast or block the form). Optional
  `refreshToken` prop re-triggers the fetch — `ListingForm` bumps it after
  every successful AI call.
- `_components/ImageGrid.tsx` (2026-09-01, replaced `ImagesStep.tsx`) — the
  form's images control. Props `{ draft, setDraft, draftId, onDraftCreated }`.
  What it adds over the old step:
  - **Drag-to-reorder** via `@dnd-kit/core` + `@dnd-kit/sortable`
    (`DndContext` + `SortableContext` with `rectSortingStrategy`, pointer +
    keyboard sensors, each tile has its own grip handle so the remove button
    stays clickable). Order matters: slot 1 is eBay's search thumbnail and
    carries a visible "Gallery image" badge. Reorder writes straight back via
    `setDraft({ image_urls })` — it is NOT persisted until Save Draft/Publish.
  - **24-image cap** — `MAX_LISTING_IMAGES` from `_lib/wizardValidation.ts`
    (eBay's real per-listing picture limit), enforced both in the picker
    (files past the cap are refused with a message naming the limit, the
    dropzone disables at the cap) and in `validateImagesStep`. The count is
    shown as `N / 24` next to the empty-state hint.
  - **Per-file validation before upload** against `ALLOWED_IMAGE_TYPES` /
    `MAX_UPLOAD_BYTES` (`_lib/imageResize.ts`). Failures are collected per
    file and rendered as a list — one bad file (a `.pdf`, an oversized JPEG,
    a single failed upload) never aborts the rest of the batch.
  - **Client-side compression** — every accepted file goes through
    `compressImage` (canvas downscale to 1600px long edge + JPEG re-encode)
    before `supabase.storage.from(LISTING_IMAGES_BUCKET).upload(path, blob,
    { contentType: "image/jpeg" })`. Paths come from `buildImagePath`
    (`_lib/storagePath.ts`) — `{tenant_schema}/{draftId}/{uuid}.{ext}`.
  - **`tenant_schema` is read from the session and never defaulted** —
    `session?.user.app_metadata?.tenant_schema`; missing means an error and
    zero uploads (the old `?? "public"` fallback could only ever fail the
    bucket's RLS check anyway).
  - **Lazy draft creation** — when `draftId` is null (a never-saved new
    draft), the first upload awaits `onDraftCreated()`, which
    `ListingForm.tsx` wires to `handleDraftCreated()` (the existing
    mutexed `saveDraft()` insert path, returning the new row's id). This removes the
    old `"unsaved"` storage folder and the orphaned-image problem with it.
  - **Remove deletes the storage object** — `pathFromPublicUrl(url)` first;
    `null` (an eBay CDN URL on an imported listing, or any non-Supabase host)
    means remove from the array only, never call storage delete. The array
    update is optimistic and a failed delete only `console.warn`s — cleanup
    must never block the seller. An in-flight delete shows a spinning
    "Removing image…" line, since the tile itself is already gone.
- `_components/ListingsTable.tsx` — the table on `page.tsx`, via the shared
  `DataTable`. Shows image thumbnail, title (links via `editHref(row)`),
  source badge, price, status badge, and an action link. `editHref(row)`
  (2026-08-31) routes `status === "published"` rows to `[id]/live` (Trading
  API edit page) and everything else to `[id]` (the create/edit form) — used by both
  the Title and Actions columns. The Source column checks `row.origin ===
  "ebay_import"` FIRST and shows an "Imported" badge in that case, before
  ever falling through to the `source_type`-based Inventory/Dropship badge
  — an imported row's `source_type` is an arbitrary default the sync route
  sets (see "Sync & live-edit flow" below), never a real source, and must
  never be shown as one. The old "View on eBay →" external link for
  published rows was removed in favor of the in-app live-edit page, which
  supersedes it. `status === "inactive"` rows (2026-09-01) are read-only:
  the Title cell renders plain text instead of a `Link`, and the Actions
  cell renders `—` instead of an Edit/Retry link — there is nothing left to
  edit on an ended eBay listing, so `editHref` is never called for them.
- `[id]/live/page.tsx` / `_components/EditLiveListing.tsx` (2026-08-31) —
  the Trading-API-based edit page for any already-published listing,
  whether this app created it or it was imported. See "Sync & live-edit
  flow" below for the full data flow; this is a completely separate code
  path from the create form/Inventory API, not a mode of `ListingForm.tsx`.
- `_lib/wizardValidation.ts` — pure field-group validators +
  `DraftFormState` type, colocated test. Since 2026-09-02 all six run on
  every render of `ListingForm.tsx` and gate the Publish button (Save Draft
  stays permissive by design) — see the SKILL.md gotcha. The filename keeps
  its `wizard` prefix only to avoid churning every import; there is no
  wizard any more.
- `_lib/listingQuality.ts` — `scoreListing(draft) → { score, checks:
  QualityCheck[] }` (2026-09-01/02). Distinct from `wizardValidation.ts`:
  that answers whether a draft *can* be published; this scores 0-100 how
  well it will *perform* — title length, photo count, item-specifics
  completeness, description length, category/price/policies presence, each
  weighted and normalized by total weight so a category with no required
  aspects doesn't cap the achievable score below 100. Consumed by
  `ListingPreview.tsx`'s quality meter.
- `_components/ListingPreview.tsx` (2026-09-01/02) — read-only "Approximate
  eBay preview" panel: gallery (first `image_urls` entry large, rest as
  thumbnails, neutral placeholder when empty), title/price/condition,
  item-specifics table (hidden when `draft.aspects` has no non-blank
  values), sanitized description (`sanitizeListingHtml`, cosmetic
  defence-in-depth on top of the server-side gate in
  `src/lib/utils/sanitizeListingHtml.ts`), and a `scoreListing`-driven
  quality meter — a percentage bar colored by band (`<50` danger, `<80`
  warning, else success) followed by only the *failing* checks' label +
  hint. Passing checks are deliberately not listed. Pure presentational
  component, no Redux/Supabase — takes `{ draft: DraftFormState }` and has
  no automated test (this repo's Jest config is `testEnvironment: "node"`,
  no jsdom, so component render tests aren't possible here). Rendered by
  `ListingForm.tsx` in the sticky right-hand column (2026-09-02), where it
  replaced the old `ReviewStep.tsx`.
- `_store/listingsSlice.ts` — `state.listings` (`items`, `loaded`, `page`,
  `pageSize`, `total`, `isFetching`). Actions: `hydratePage` (aliased
  `hydrateListingDrafts`), `addListingDraft`, `updateListingDraft`,
  `removeListingDraft`, `setFetching`. Thunk: `fetchListingsPage({ page,
  pageSize, status })` — `status` is a `ListingStatusFilter`
  (`ListingStatus | "all"`, 2026-09-01), pushed into the Supabase query via
  `.eq("status", status)` when not `"all"` (same filter-pushdown pattern as
  Sales' `fetchSalesPage`, not client-side filtering).

## Data flow

Same pattern as every other CRUD feature: `dashboard/layout.tsx` fetches page
1 of `ebay_listing_drafts`, `StoreProvider` hydrates `state.listings`. Draft
CRUD writes go straight to Supabase from `ListingForm.tsx` (RLS-protected),
then dispatch the local slice action — no refetch. The two eBay-read calls
(category search, business policies) and the publish action are the only
server round-trips, via `src/app/api/listings/`, since only those need the
tenant's stored eBay OAuth token (`src/lib/integrations/ebay/publish.ts`).
`EditLiveListing.tsx` (Part 2, below) follows the same dispatch-local-action-
after-server-write pattern for its own save/delete, via `listingsSlice`'s
existing `updateListingDraft` action — no new slice actions were needed
(`removeListingDraft` is no longer used by this page — see the "inactive,
not deleted" note in Part 2).

`page.tsx`'s default view is filtered to `status="published"` ("Active" in
the dropdown) — the layout's hydration always reads page 1 unfiltered
(same contract every paginated feature's initial hydration follows), so
`page.tsx` dispatches one extra `fetchListingsPage` on mount to apply that
default. This differs from Sales/Expenses/Purchases, whose default filter
is `"all"` and therefore already matches the unfiltered hydration with no
extra fetch needed.

## Publish flow

`POST /api/listings/[id]/publish` runs a resumable 3-step eBay Inventory API
flow (`src/lib/integrations/ebay/publish.ts`'s `publishListing`):
`createOrReplaceInventoryItem` (idempotent by SKU, via `PUT`) →
`createOffer`/`updateOffer` (depending on whether `ebay_offer_id` already
exists) → `publishOffer`. A first-time `createOffer` call retries up to 3
times (1s/2s/3s backoff) if eBay returns errorId 25751 — an eventual-
consistency gap where the SKU isn't immediately queryable right after the
PUT above (see `SKILL.md`'s gotcha) — before giving up. The offer's
`merchantLocationKey` comes from the draft's own `merchant_location_key`
field (chosen per-tenant in the form's Shipping section, not a global env
var — see `SKILL.md`'s gotcha for why that used to be broken for every
tenant but one). The inventory item's `product.aspects` comes from the
draft's `aspects` field (chosen per-category in the form's Listing section
— see `SKILL.md`'s gotcha for why this can't be a fixed field list,
and its follow-up gotcha for why product identifiers like EAN needed a
second fix the same day even after Brand was handled). `status` moves
`draft → publishing → published`, or
`→ failed` with `publish_error` set on any error — the draft stays editable
and re-publishable after a failure. The SKU is generated once
(`generateListingSku()`, `KN` + 12 random alphanumeric chars) and persisted
to `ebay_sku` before the first eBay call, then reused on every retry. See
`src/lib/integrations/SKILL.md`'s equivalent section for the eBay OAuth
scope/token-refresh mechanics this reuses (`sell.inventory`, already granted).

## Sync & live-edit flow (Part 2, 2026-08-31)

`ebay_listing_drafts` gained an `origin` column (`"app"` default, or
`"ebay_import"` — migration `038`): a listing this app published vs. one
pulled in from the tenant's existing eBay account. This is orthogonal to
`status`; only `status` decides which edit path a row uses (see
`ListingsTable.tsx`'s `editHref` above) — `origin` only decides what the
Source column shows and which rows `POST /api/listings/ebay/sync` is
allowed to touch.

**Sync** (`POST /api/listings/ebay/sync`): calls the pre-existing
`fetchActiveListings` (Trading API `GetMyeBaySelling`, already used by the
Dropshipping feature) and merges the result into `ebay_listing_drafts`.
Two correctness-critical things this route does, in this order:
1. **Never overwrites an `origin="app"` row.** Before upserting, it reads
   every existing `origin="app"` row's `ebay_listing_id` and excludes those
   from the batch — `GetMyeBaySelling`'s summary carries none of a listing's
   `aspects`/policies/`merchant_location_key`, so upserting over an
   app-published listing would silently blank all of that.
2. **Reconciles stale listings, both origins, by marking them `inactive`
   (2026-09-01 — previously deleted the row outright).** After upserting,
   any existing `origin="ebay_import"` row whose `ebay_listing_id` is no
   longer in the fresh active list gets `status` set to `"inactive"` —
   scoped strictly to `origin="ebay_import"` on both the read and the
   update, so an app-created `draft`/`failed` row (which has no active eBay
   listing yet by design) is never touched by *this* update. A SECOND update
   does the same for `origin="app"` rows, reusing the `appOwnedIds` set
   already fetched for step 1 — a tenant's own published listing ended
   outside the app (Seller Hub, or a duplicate Delete hitting eBay
   errorCode 1047) would otherwise stay `status="published"` forever, since
   nothing else ever revisits an `origin="app"` row. This is a different
   operation from step 1's exclusion, not a contradiction of it: step 1
   protects against a blind *overwrite* of a still-active listing; this
   only ever flips the status of a row confirmed gone from eBay's active
   list. Both updates also correct a listing ended via this app's own
   Delete action, if that action's own local-row update ever failed. The
   route's JSON response is `{ imported, deactivated }` (renamed from
   `removed` when this switched from delete to update).
   Marking `inactive` rather than deleting means a listing a tenant deletes,
   or one eBay ends behind their back, stays visible as history under the
   Listings page's "Inactive" filter instead of vanishing with no trace —
   see `ListingStatus` in `src/types/index.ts` and migration
   `039_ebay_listing_drafts_inactive_status.sql`.

Newly-imported rows get placeholder `source_type: "inventory"`/
`quantity: 1`/`condition: "used"` — `GetMyeBaySelling`'s summary doesn't
carry real quantity/condition, and `source_type` doesn't meaningfully apply
to an imported listing at all (see `ListingsTable.tsx`'s note above on why
the Source column never shows it). These self-correct the first time
someone opens the listing's live-edit page, which does a full `GetItem`
fetch and writes the real values back on save.

**Live edit** (`EditLiveListing.tsx`, reached via `[id]/live` for any
`status="published"` row): fetches full detail via `GET
/api/listings/[id]/ebay-detail` (Trading API `GetItem`), lets the tenant
edit title/description/price/quantity/condition/images/aspects (category is
read-only — eBay restricts category changes on active listings), saves via
`POST /api/listings/[id]/revise` (`ReviseItem`), deletes via `POST
/api/listings/[id]/end` (`EndItem`, then marks the local row `inactive`
rather than deleting it — 2026-09-01, see the "inactive, not deleted" note
above; the row stays visible under the Listings page's "Inactive" filter).
The aspects picker reuses the create form's own `GET /api/listings/ebay/aspects`
route — required-aspect names are category-driven, not creation-method-
driven, so the same Taxonomy API answer applies whether or not this app
originally created the listing.

`ebay-detail` self-corrects staleness on load, not just on Sync: `GetItem`'s
`SellingStatus.ListingStatus` (`EbayListingDetail.listingStatus`, added
2026-09-01) is eBay's own ground truth for whether the listing is still
live. When it's anything other than `"Active"` (ended in Seller Hub,
expired, or ended here already with a failed local-row status update), the
route marks the local row `inactive` itself and returns `410` with
`{ error, ended: true, draft: <updated row | null> }` instead of the normal
detail payload — no need to wait for a Sync click or a failed Delete to
discover it, since this is the exact same `GetItem` call already being made
to load the edit form. `EditLiveListing.tsx` treats a `410` as a distinct
case from a load failure: it dispatches `updateListingDraft` with the
returned row (when present), toasts the message, and redirects to
`/dashboard/listings` instead of rendering a dead edit form.

**Save Changes is a real `<form>` with native + computed validation
(2026-09-01)** — this page used to let Save stay clickable with empty
required fields (a bare `<div>`, `onClick={handleSave}`, no `required`
attributes anywhere). Fixed to follow this project's standard form
convention (see `AGENTS.md` → "Form conventions"): the fields are wrapped
in `<form id="edit-live-listing-form" onSubmit={handleSave}>`, every
required field carries a real `required` attribute (including the dynamic
required-aspect fields, and the product-identifier "doesn't apply" case via
`required={!isNotApplicable}`), and Save is `type="submit"
form="edit-live-listing-form" disabled={saving || !isFormValid}` where
`isFormValid` is computed inline from current field state. Saving shows a
spinning `Loader2` icon next to "Saving…"; the initial page load shows one
next to "Loading listing…" instead of bare text.

**The single most important correctness property in this flow**: `revise`
never blindly resends `ItemSpecifics` to eBay. It re-fetches the listing's
CURRENT live aspects via `fetchListingDetail` (never trusting anything the
client submitted as "the original"), then `buildAspectsForRevise(current,
submitted)` decides whether to include `aspects` in the `ReviseItem` call at
all — omitted entirely when nothing changed, per eBay's own guidance that
resending unchanged `ItemSpecifics` risks "attribute version problems." This
only works correctly because `EditLiveListing.tsx` always submits the real
`aspects` state it fetched (seeded from `ebay-detail`'s response, merged on
every field edit, never reset) — see this folder's `SKILL.md` gotcha if
you're touching either side of this contract.

New Trading API functions live in `lib/integrations/ebay/listings.ts`
alongside the pre-existing `fetchActiveListings`: `fetchListingDetail`,
`reviseListing`, `endListing`, `buildAspectsForRevise`,
`conditionIdToListingCondition`. See that file's own `listings.test.ts` for
the XML shapes.

## Shared dependencies

- `components/ui/{Modal is NOT used — dedicated pages instead, FormFields,
  Button, DataTable, Badge, Pagination, Toast}`
- `components/layout/PageHeader`
- `store/slices/{auditLogsSlice,currentUserSlice,companyProfileSlice}` —
  `currentUserSlice`'s `tenantPlan` + `aiEnabled` are what gate the AI
  controls (see `aiVisible` above)
- `app/dashboard/inventory/_store/inventorySlice` — read-only, `selectorItems`
  for the Source step's Inventory picker
- `lib/utils/{audit,currency,detectPlatform,permissions,pagedQuery}` —
  `planGating`'s `hasMessagingAndListings` is used by `BusinessEbayGate.tsx`
  specifically, not `hasPlatformIntegrations`; `hasAiFeatures` is used by
  `ListingForm.tsx` and `AiUsageNote.tsx` to compute `aiVisible`
- `lib/ai/` — server-only (Anthropic client, prompt builders, quota
  accounting, `requireAiAccess`). **Never imported by anything in this
  folder**; the UI only ever talks to it through `app/api/listings/ai/`
- `app/api/listings/ai/{describe,aspects,usage}` — the three routes
  `DescriptionEditor.tsx`, `AspectsStep.tsx` and `AiUsageNote.tsx` call.
  `describe`/`aspects` are guarded by `requireAiAccess` (plan + tenant flag
  + `manage_listings` + quota); `usage` deliberately is not, so the note
  still reads once quota is exhausted
- `@tiptap/react` + `@tiptap/starter-kit` (added 2026-09-02) — used only by
  `DescriptionEditor.tsx`. No other TipTap package is installed; anything
  needing `@tiptap/extension-*` (Placeholder, Link, …) is a new dependency,
  not something already available
- `store/slices` — `s.integrations.connections` (read by `BusinessEbayGate.tsx`,
  hydrated app-wide by `dashboard/layout.tsx`/`StoreProvider`, same slice
  Dropshipping/Integrations use)
- `lib/integrations/{authGuard,tokenStore,ebay}` — server-only, used by the
  three API routes, never imported client-side
- `lib/integrations/ebay/{generateSku,publishPayloads,publish}` — SKU
  generation, pure payload builders, and the actual eBay HTTP calls
  (`searchCategories`, `fetchRequiredAspects`, `fetchBusinessPolicies`,
  `fetchInventoryLocations`, `createInventoryLocation`, `publishListing`).
  `searchCategories` uses `lib/integrations/ebay/appToken.ts`'s application
  token internally, not the tenant's connection token — see SKILL.md's
  gotcha.
- `lib/integrations/ebay/listings.ts` — Trading API functions. Pre-existing
  `fetchActiveListings` is shared with the Dropshipping feature (which uses
  it independently, for its own `dropship_listings` table); everything else
  in the file (`fetchListingDetail`, `reviseListing`, `endListing`,
  `buildAspectsForRevise`, `conditionIdToListingCondition`, 2026-08-31) is
  this feature's own, used only by the four `/api/listings/[id]/*` and
  `/api/listings/ebay/sync` routes.
- Supabase Storage bucket `listing-images` (new — see `supabase/SKILL.md`),
  addressed through `_lib/storagePath.ts` (`LISTING_IMAGES_BUCKET`,
  `buildImagePath`, `pathFromPublicUrl`) — never a hardcoded bucket name or
  hand-built path
- `_lib/imageResize.ts` — `compressImage`, `MAX_UPLOAD_BYTES`,
  `ALLOWED_IMAGE_TYPES` (browser-only canvas work; `fitWithin` is the pure,
  tested half)
- `@dnd-kit/core` + `@dnd-kit/sortable` (added 2026-09-01) — used only by
  `ImageGrid.tsx`; `@dnd-kit/utilities` is deliberately NOT imported (the
  transform string is built inline) so the feature depends on nothing that
  isn't in `package.json`
- `types` (`EbayListingDraft` — includes `origin: "app" | "ebay_import"`,
  2026-08-31 — `ListingSourceType`, `ListingCondition`, `ListingStatus`)

## Tests

`npx jest dashboard/listings` runs `_store/listingsSlice.test.ts` and
`_lib/wizardValidation.test.ts`. `npx jest lib/integrations/ebay/listings`
covers the Trading API functions this feature added to that shared file.
