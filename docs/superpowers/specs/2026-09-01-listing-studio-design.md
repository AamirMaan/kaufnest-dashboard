# Listing Studio — Rich Description, AI Assist, Image Grid & Live Preview

**Date:** 2026-09-01
**Feature:** `src/app/dashboard/listings/` (+ `src/lib/ai/`, `src/app/admin/`)
**Status:** Approved for implementation planning

## Problem

The listing creation flow is a seven-step wizard of plain form fields. It is
functionally complete — it publishes to eBay — but it is strictly worse than
listing on eBay directly: the description is a bare `<textarea>`, images
upload in whatever order they were picked, required item specifics are typed
by hand one at a time, and the seller cannot see what the listing will look
like until the final Review step (or, in practice, until after publishing).

The goal is to make sellers *prefer* this flow to eBay's own. That means
removing the tedious parts (writing copy, filling item specifics), making the
visual parts visual (image order, preview), and showing the seller whether
their listing is any good *before* they publish it.

## Scope

**In scope:** rich description editor with AI generate/improve, AI item-specifics
fill, image grid with drag-reorder + compression + lifecycle, live eBay preview
with a listing quality score, single-page form rewrite, per-tenant AI metering
with quota, platform-admin AI visibility toggle, per-user usage visibility.

**Explicitly out of scope:** photo-to-draft (upload photos → full listing),
listing templates, price guidance from comparable listings, multi-variation
listings, autosave, and the `listing-images` bucket's public-enumeration issue
(see "Known tension" below).

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Form shape | Single scrolling page, three sections, sticky preview column | A preview that updates as you type has nowhere to live in a 7-step wizard. Also dissolves the documented "Save Draft skips validation" trap, since every field is visible at once. |
| Editor | TipTap (`@tiptap/react`) with a restricted extension set | Headless, so it inherits the existing design tokens rather than fighting them; extension-based, so only eBay-legal marks are even constructible. Lexical needs a hand-built toolbar for the same result; `execCommand` is deprecated and emits messy HTML. |
| Description storage | HTML in the existing `description text` column | No migration. Legacy plain-text drafts are wrapped in `<p>` on load — a four-line adapter beats a five-schema fan-out. |
| HTML sanitization | Server-side, in `publishPayloads.ts` | The client is not a security boundary — draft rows are written directly from the browser via Supabase. `publishPayloads.ts` is the one place both eBay-bound description fields are built. |
| Model | `claude-opus-5` at `effort: "low"` | Short structured generation, not reasoning. Effort is the first cost lever that does not trade model quality. |
| Streaming | No | Sanitization requires a complete HTML document; a half-streamed tree cannot be safely injected into a live editor. Non-streaming with a real busy state is the honest trade. |
| Image reorder | `@dnd-kit` (core + sortable) | Native HTML5 drag events avoid a dependency but degrade badly on touch, and sellers use tablets. |
| Image compression | Hand-rolled canvas resize, no dependency | ~40 lines. The dimension maths is pure and unit-testable; the canvas encode is not, so they are split. |
| Image cap | 24 | eBay's actual per-listing limit. There is no cap in the code today. |
| AI metering store | `control.tenant_ai_usage` (Project A) | Quota is a billing concern; `control.tenants` already owns `plan`. Tenant-side RLS cannot tamper with it, and it avoids `run_on_all_tenant_schemas` entirely. |
| AI visibility control | `control.tenants.ai_enabled`, default `true` | The plan *grants* AI; the admin toggle *revokes* it per tenant (abuse, cost, or a tenant who does not want it). Defaulting `false` would hide a feature the Business plan already advertises on the pricing page. |
| Quota scope | Tenant-wide pool, per-user attribution | Sellers share a subscription; a per-user quota would strand allowance on inactive users. Per-user rows exist for visibility, not enforcement. |

## Architecture

Five new units, each independently testable, plus the form rewrite.

```
src/lib/ai/                    server-only
  client.ts                    Anthropic client + AI_MODEL constant
  prompts.ts                   system prompts + dynamic aspect JSON schema
  quota.ts                     read/increment control.tenant_ai_usage
  prompts.test.ts

src/app/api/listings/ai/
  describe/route.ts            POST → { html }
  aspects/route.ts             POST → { aspects }
  usage/route.ts               GET  → caller's + tenant's usage

src/app/api/admin/
  ai-usage/route.ts            GET  → per-tenant usage (platform admin)

src/app/dashboard/listings/
  _components/ListingForm.tsx        (was ListingWizard.tsx)
  _components/DescriptionEditor.tsx
  _components/ImageGrid.tsx          (was ImagesStep.tsx)
  _components/ListingPreview.tsx
  _components/AiUsageNote.tsx
  _lib/listingQuality.ts       + test
  _lib/imageResize.ts          + test
  _lib/storagePath.ts          + test

src/app/admin/
  _components/AiUsageModal.tsx
  _components/TenantActions.tsx      (+ AI toggle button)
```

### Data model

One control-plane migration, `supabase/control-plane/005_tenant_ai_usage.sql`:

```sql
alter table control.tenants
  add column if not exists ai_enabled boolean not null default true;

create table if not exists control.tenant_ai_usage (
  tenant_id     uuid not null references control.tenants(id) on delete cascade,
  user_id       uuid not null,          -- Project B auth user id; no FK (cross-project)
  period        date not null,          -- first day of billing month, UTC
  kind          text not null check (kind in ('describe','aspects')),
  calls         integer not null default 0,
  input_tokens  bigint  not null default 0,
  output_tokens bigint  not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, user_id, period, kind)
);

create index if not exists idx_tenant_ai_usage_period
  on control.tenant_ai_usage (tenant_id, period);

alter table control.tenant_ai_usage enable row level security;
```

**No tenant-schema migration.** `description` is already `text`, `image_urls`
is already `text[]`, and image order is just array order.

`user_id` carries no foreign key on purpose: auth users live in Project B,
this table lives in Project A. Cross-project referential integrity is not
available, and the row is a usage record — an orphan after a user is deleted
is correct behaviour, not corruption.

The quota constant goes on `PlanLimits` in `src/lib/utils/planGating.ts` as
`aiGenerationsPerMonth`: **300** for `business` and `trial`, **0** for
`starter` and `pro`. That caps worst-case spend near $9–15/tenant/month
against a €50 subscription. `pricing.ts` already derives its feature ticks
from `getPlanLimits`, so the pricing page can quote the number without drift.

### The AI gate has three independent conditions

```
plan allows it        hasAiFeatures(plan)          — business | trial
tenant not hidden     tenant.ai_enabled            — platform admin toggle
quota remaining       usage < aiGenerationsPerMonth
```

The first two control **visibility** — when either is false the AI controls
are *not rendered at all* (not rendered-and-disabled). The third controls
**availability** — the controls render but disable, with a message stating
usage against the limit, because a seller who has hit a quota needs to know
why, whereas a seller on a plan without the feature should not see chrome for
something they cannot buy into from here.

All three are re-checked server-side on every route. Hidden UI is a
presentation choice; it is never the enforcement.

`aiEnabled` reaches the client on the existing path: `dashboard/layout.tsx`
already reads the tenant row from the control plane and passes `tenantPlan`
into `StoreProvider`, which dispatches into `currentUserSlice`. Add
`aiEnabled` alongside it — no new plumbing, one new field in three files.

### AI request contracts

Both routes run the same guard chain, in order. Any failure short-circuits
before an API call is made:

1. Auth → user + `tenant_schema` from `app_metadata`
2. `manage_listings` permission (same guard the publish route uses)
3. `hasAiFeatures(plan)` **and** `tenant.ai_enabled`
4. Quota check against `control.tenant_ai_usage`
5. Call Claude → record usage from `response.usage`

Usage is recorded whenever `response.usage` is present, including on a
refusal — those tokens are billed and must be counted.

**`POST /api/listings/ai/describe`**

```
{ mode: "generate" | "improve", title, condition, categoryName,
  aspects, currentHtml? }  →  { html }
```

`claude-opus-5`, `max_tokens: 4000`, `output_config: { effort: "low" }`. The
system prompt carries `cache_control: { type: "ephemeral" }` and holds the
style guide plus the eBay HTML rules; it must be byte-stable across requests
or caching silently stops working (a test asserts this). Response HTML is
sanitized before it reaches the editor.

**`POST /api/listings/ai/aspects`**

```
{ categoryId, requiredAspectNames[], title, description, imageUrls[] }
  →  { aspects: Record<string, string> }
```

Images pass **by URL** (`{ type: "image", source: { type: "url", url } }`),
capped at the **first 4** — image tokens dominate the cost of this call and
the fifth photo rarely adds signal. Uses structured outputs
(`output_config.format`) with a JSON schema built dynamically from
`requiredAspectNames`, each property a string, `additionalProperties: false`,
so the model cannot return an aspect eBay did not ask for.

Two rules that exist for commercial reasons, not technical ones:

- **An empty string means "could not determine".** The model must never
  invent a Brand or a Model number. Wrong item specifics get eBay listings
  demoted or removed, which is worse for the seller than a blank field.
- **AI-filled fields render with an "AI" badge that clears on first edit.**
  Nobody should publish a machine guess believing they typed it.

**`GET /api/listings/ai/usage`**

```
→ { limit, tenantUsed, mine: { calls }, perUser?: [{ userId, name, calls }] }
```

`perUser` is included only for `admin` / `super_admin`. Names are not in the
control plane — the route reads usage rows from Project A, then resolves the
ids against the tenant schema's `profiles` table in Project B. Two clients,
two projects, one response.

### Admin surface

- **`TenantActions.tsx`** gains an `AI: On` / `AI: Off` toggle button that
  PATCHes `{ ai_enabled }` to the existing `/api/admin/tenants/[id]` route.
  One click, no modal — it is a reversible visibility flag, not a destructive
  action. `EditTenantModal` gains the same field as a checkbox so it
  participates in the existing partial-diff edit flow.
- **`page.tsx`** gains an "AI usage" column showing `142 / 300` for the
  current period, fetched from `GET /api/admin/ai-usage`. Clicking opens
  `AiUsageModal` with the per-user breakdown for that tenant.

Note for the verifier: this writes `control.tenants.ai_enabled`, never `plan`
or `status`. The Stripe-webhook-owns-plan invariant is untouched.

### Tenant-facing usage

`AiUsageNote.tsx` renders under the AI controls in the form: "You've used 12
of your team's 300 AI generations this month" for a regular user, plus a
per-user breakdown for admins. Also surfaced as a small section in Settings
so it is findable without opening a draft.

**Known gap:** during platform-admin impersonation, usage is attributed to
the impersonated user, because that is who the session is. Not solved here;
recorded so it is not mistaken for a bug.

### Image pipeline

`ImageGrid.tsx` replaces `ImagesStep.tsx`:

- **24 cap**, enforced in the UI and in `validateImagesStep`
- **Sortable grid** via `@dnd-kit/sortable`; slot 1 badged "Gallery image" —
  that slot is the search-results thumbnail, which is the whole reason
  reordering is worth building
- **Compress before upload** — `fitWithin(w, h, 1600)` then canvas encode at
  JPEG 0.85; skipped when the image is already smaller
- **MIME allowlist** (jpeg/png/webp) and a 15 MB pre-compression reject
- **Path** becomes `${tenantSchema}/${draftId}/${crypto.randomUUID()}.jpg`,
  replacing `${Date.now()}-${file.name}` — this kills both the
  same-millisecond collision and the raw-user-filename problem while keeping
  the tenant prefix that the bucket's RLS policies in
  `022_listing_images_bucket.sql` match on
- **Delete on remove**, closing the orphan leak, via a pure
  `pathFromPublicUrl(url)` helper

`pathFromPublicUrl` carries the one genuinely dangerous edge case in this
design: **listings synced from eBay hold eBay CDN URLs, not ours.** The
helper returns `null` for any URL outside our bucket, and a `null` path means
remove-from-array-only. Getting this wrong means issuing storage deletes
against images this app does not own.

The `"unsaved"` folder disappears. The draft row is created lazily **on first
image upload** rather than on page open, so `draftId` is never null at upload
time, and sellers who open the form and leave still create no empty rows.

This is not autosave (which stays out of scope): the row is written once, at
the moment an upload needs a folder to live in. Subsequent field edits are
still saved only when the seller clicks Save Draft or Publish.

### Preview & quality score

`_lib/listingQuality.ts` is pure:

```ts
export function scoreListing(draft): { score: number; checks: QualityCheck[] }
```

Weighted checks: title 60–80 chars (eBay indexes the full field and most
sellers stop at 40), ≥6 images, all required aspects filled, description ≥300
chars, category set, price > 0, policies selected. Every failing check
carries a `hint` saying what to do, not just what is wrong.

`ListingPreview.tsx` renders gallery, title, price, condition, an
item-specifics table from `aspects`, and the sanitized description. Labelled
**"Approximate eBay preview"** — it will not be pixel-identical and must not
pretend to be.

### Form structure

`ListingWizard.tsx` → `ListingForm.tsx`: one scrolling form, three labelled
sections — **Item** (source, title, description, images), **Listing**
(category, aspects, price/qty/condition), **Shipping** (policies, location) —
with the preview and score in a sticky right column that collapses below the
form under `lg`. Both route wrappers (`new/page.tsx`, `[id]/page.tsx`) and
the feature docs update with the rename.

Per `AGENTS.md` form conventions: a real `<form id="listing-form">`,
`required` on the actual inputs and not only the `<Field>` labels, submit
buttons as `type="submit" form="listing-form"`, busy labels with
`<Loader2 className="animate-spin" />`.

**Save Draft and Publish need different validity rules, and both are
correct.** The SKILL.md documents incomplete drafts as intentional — a draft
is allowed to be half-finished. So Save Draft stays permissive (it can always
succeed, so it is never falsely disabled), while Publish gets
`disabled={publishing || !isPublishable}`. The form convention and the
documented draft behaviour survive intact.

## Error handling

| Failure | Behaviour |
| --- | --- |
| AI call fails | Toast; editor content untouched. Never a partial write. |
| Quota exhausted | Controls render but disable, with "N of 300 used this month" — never a dead click |
| Plan or tenant flag off | Controls not rendered at all |
| Anthropic typed errors | Mapped to user-safe copy; raw provider errors never reach the client, matching the existing rule for Postgres errors |
| Upload fails | Per-file error; other files in the batch still land |
| Storage delete fails on remove | Logged; the image still leaves the array — a GC failure must not block the seller |
| eBay publish fails | Unchanged from today, including the errorId 25751 propagation retry |

## Testing

Colocated, pure, no Supabase or Redux dependencies:

- `_lib/listingQuality.test.ts` — score bands, per-check hints
- `_lib/imageResize.test.ts` — `fitWithin` for portrait, landscape, already-small
- `_lib/storagePath.test.ts` — **including eBay CDN URLs returning `null`**
- `_lib/wizardValidation.test.ts` — extended for the 24 cap and
  draft-valid vs publishable
- `src/lib/ai/prompts.test.ts` — aspect schema built from required names;
  system prompt byte-stable (guards prompt caching)
- `src/lib/integrations/ebay/publishPayloads.test.ts` — extended: `<script>`
  stripped, allowed tags survive, both eBay description fields sanitized

Per the working agreement in `AGENTS.md`, these are not run mid-task — the
user runs `npx jest dashboard/listings` and reports output.

## New dependencies

`@anthropic-ai/sdk`, `@tiptap/react` + `@tiptap/starter-kit`, `@dnd-kit/core`
+ `@dnd-kit/sortable`, `isomorphic-dompurify` (one sanitizer implementation
serving both server enforcement and client preview).

New env var: `ANTHROPIC_API_KEY` in `.env.local.example`. **Not**
`NEXT_PUBLIC_` — `src/lib/ai/` is server-only and the PreToolUse verifier
enforces both halves of that.

## Known tension

Aspect fill sends image URLs to Anthropic, which works precisely *because*
the `listing-images` bucket is publicly readable. That bucket's read policy
(`FOR SELECT USING (bucket_id = 'listing-images')`) has no path or auth
restriction, so anyone can enumerate every tenant's object paths — flagged
during Task 7's review as an accepted tradeoff for eBay's benefit.

This design adds a **second** consumer of that decision, which raises the
cost of revisiting it later. Recorded deliberately: fixing the bucket is out
of scope here, and whoever picks it up must account for both eBay and the
vision path needing fetchable URLs.

**Accepted by the product owner, 2026-09-01**, on the grounds that listing
images are destined to be public on eBay regardless. Noted for whoever
revisits this: the accepted risk is *enumeration*, which is broader than the
images being individually public. The policy permits listing object paths
across every tenant, so drafts that were never published are also
discoverable. That was judged acceptable; it is not an oversight.

## Implementation phasing

This is larger than one sitting, and the pieces have real dependencies. The
implementation plan should sequence them as:

1. **Foundation** — control-plane migration, `planGating` quota constant,
   `aiEnabled` through `layout.tsx` → `StoreProvider` → `currentUserSlice`,
   admin toggle + usage view. Ships independently and is verifiable on its own.
2. **Image pipeline** — `ImageGrid`, resize/path/delete helpers, 24 cap.
   Independent of AI; the highest-value change per line of code.
3. **Form rewrite + preview** — `ListingForm`, `ListingPreview`,
   `listingQuality`. Depends on 2 for the image section.
4. **AI** — `src/lib/ai/`, both routes, `DescriptionEditor`, `AiUsageNote`.
   Depends on 1 for the gate and 3 for where the controls live.

Sanitization in `publishPayloads.ts` lands with phase 3, not phase 4 — the
editor produces HTML before any AI does.

## Rollout

1. Apply `control-plane/005_tenant_ai_usage.sql` to Project A.
2. Set `ANTHROPIC_API_KEY` in the deployment environment.
3. Existing Business/trial tenants get `ai_enabled = true` from the column
   default; no backfill needed.
4. Watch `control.tenant_ai_usage` for the first weeks — the 300/month quota
   is derived from margin arithmetic, not from observed seller behaviour, and
   is a one-line change in `planGating.ts` once real numbers exist.
