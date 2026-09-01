# eBay Listing Sync, Edit & Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tenant pull in every listing already live on their eBay account (not just ones this app created), and edit or end any of them from the Listings page.

**Architecture:** The Inventory API stays scoped to first-time publish only (unchanged wizard). A new "Sync from eBay" action pulls the full active-listing list via the Trading API (`GetMyeBaySelling`, already built) and merges it into the same `ebay_listing_drafts` table with a new `origin` column. Any listing with `status = "published"` — whether app-created or imported — opens a new Trading-API-based edit page (`GetItem`/`ReviseItem`) instead of the wizard; deleting calls `EndItem`.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), Redux Toolkit, eBay Trading API (XML over HTTPS, via the existing `tradingApiCall` helper).

**Spec:** `docs/superpowers/specs/2026-08-31-ebay-listing-sync-edit-design.md`

## Global Constraints

- Inventory API (the wizard, `publish.ts`) is never touched by this plan — first-time publish behavior is unchanged.
- All new routes follow the exact guard pattern already used by every route in this feature: `requireIntegrationAdmin()` → explicit `manage_listings` permission check via a `profiles` lookup → eBay connection check → token refresh (500 on failure) → try/catch around the eBay call → 502 with the eBay error message (logged via `console.error` first).
- The unique index on `ebay_listing_id` MUST be a full (non-partial) index — a partial index breaks Supabase's `.upsert(rows, { onConflict })` inference, and Postgres treats multiple `NULL`s as non-conflicting under a plain `UNIQUE` index anyway (see `033_ebay_messages_full_unique_index.sql` for the exact prior mistake this avoids repeating).
- `ItemSpecifics` must never be resent in a `ReviseItem` call unless at least one aspect value actually changed (`buildAspectsForRevise`) — eBay's own guidance warns unconditional resending risks "attribute version problems."
- `PictureDetails` in `ReviseItem` is replace-all — always send the complete current image list, never a partial/diffed one.
- Category is read-only once a listing is published — no task in this plan makes it editable.
- The sync's upsert must never overwrite an `origin = "app"` row's data, even if eBay's active list happens to include that same `ebay_listing_id` — see Task 3.

---

### Task 1: `origin` column, unique index, and type updates

**Files:**
- Create: `supabase/migrations/038_ebay_listing_drafts_origin.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql` (add `origin` to the `ebay_listing_drafts` `CREATE TABLE`)
- Modify: `src/types/index.ts` (add `origin` to `EbayListingDraft`)
- Modify: `src/lib/integrations/ebay/publishPayloads.test.ts` (add `origin` to `makeDraft()`)
- Modify: `src/app/dashboard/listings/_store/listingsSlice.test.ts` (add `origin` to `makeDraft()`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `EbayListingDraft.origin: "app" | "ebay_import"` — every later task that reads/writes an `EbayListingDraft` row relies on this field existing.

- [x] **Step 1: Write the migration**

```sql
-- supabase/migrations/038_ebay_listing_drafts_origin.sql
-- ============================================================
-- 038 — origin column on ebay_listing_drafts, for imported eBay listings
--
-- Listings this app didn't create (imported via a new "Sync from eBay"
-- action, or created by this app before this feature existed) need to be
-- distinguished from ones the wizard created, so the UI knows whether
-- clicking a row should open the wizard (draft/failed, app-created only)
-- or the new Trading-API edit page (anything already published).
--
-- Also adds a full (non-partial) unique index on ebay_listing_id, needed
-- for the sync route's upsert(onConflict: "ebay_listing_id"). Deliberately
-- NOT partial — a partial index breaks Supabase's upsert onConflict
-- inference, and multiple NULLs (unpublished drafts) never conflict under
-- a plain UNIQUE index anyway. See 033_ebay_messages_full_unique_index.sql
-- for the exact mistake this avoids repeating for a different table.
--
-- Also mirrored into provision_tenant_schema() (005) — the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.ebay_listing_drafts
    add column if not exists origin text not null default 'app'
      check (origin in ('app', 'ebay_import'));

  create unique index if not exists idx_ebay_listing_drafts_ebay_listing_id
    on {{schema}}.ebay_listing_drafts (ebay_listing_id);
$$);
```

- [x] **Step 2: Mirror the column into `provision_tenant_schema()`**

In `supabase/migrations/005_tenant_provisioning.sql`, find the `ebay_listing_drafts` `CREATE TABLE` block (it has `merchant_location_key` and `aspects` columns near the bottom of its column list) and add `origin` right after `aspects`:

```sql
      image_urls             text[] NOT NULL DEFAULT '{}',
      aspects                jsonb NOT NULL DEFAULT '{}'::jsonb,
      origin                 text NOT NULL DEFAULT 'app' CHECK (origin IN ('app', 'ebay_import')),
      fulfillment_policy_id  text,
```

- [x] **Step 3: Add the field to the TypeScript type**

In `src/types/index.ts`, find the `EbayListingDraft` interface and add `origin` right after `aspects`:

```ts
  image_urls: string[];
  aspects: Record<string, string>;
  origin: "app" | "ebay_import";
  fulfillment_policy_id: string | null;
```

- [x] **Step 4: Update the two test fixtures that construct a full `EbayListingDraft`**

In `src/lib/integrations/ebay/publishPayloads.test.ts`, find `makeDraft()` and add `origin: "app",` right after `aspects: { Brand: "Acme" },`:

```ts
    aspects: { Brand: "Acme" },
    origin: "app",
    fulfillment_policy_id: "fp-1",
```

In `src/app/dashboard/listings/_store/listingsSlice.test.ts`, find `makeDraft()` and add `origin: "app",` right after `merchant_location_key: null,`:

```ts
    merchant_location_key: null,
    origin: "app",
    ebay_sku: null,
```

- [x] **Step 5: Verify everything still type-checks and passes**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx jest lib/integrations/ebay/publishPayloads dashboard/listings/_store`
Expected: all passing (these two suites are the only ones constructing a full `EbayListingDraft` literal).

- [x] **Step 6: Commit**

```bash
git add supabase/migrations/038_ebay_listing_drafts_origin.sql supabase/migrations/005_tenant_provisioning.sql src/types/index.ts src/lib/integrations/ebay/publishPayloads.test.ts src/app/dashboard/listings/_store/listingsSlice.test.ts
git commit -m "feat(listings): add origin column for imported eBay listings"
```

---

### Task 2: Trading API listing-management functions (`fetchListingDetail`, `reviseListing`, `endListing`, `buildAspectsForRevise`)

**Files:**
- Modify: `src/lib/integrations/ebay/listings.ts`
- Create: `src/lib/integrations/ebay/listings.test.ts`

**Interfaces:**
- Consumes: `tradingApiCall`, `tagText`, `decodeXml`, `escapeXml` from `./tradingApi` (all already exported — `escapeXml` is new to this file, the other three are already imported here); `ListingCondition` from `@/types`.
- Produces: `EbayListingDetail`, `fetchListingDetail(accessToken, itemId)`, `ReviseListingInput`, `reviseListing(accessToken, itemId, changes)`, `endListing(accessToken, itemId)`, `buildAspectsForRevise(original, submitted)`, `conditionIdToListingCondition(conditionId)` — Task 4's routes call all of these directly.

**Note on the GetItem/ReviseItem/EndItem XML shapes below:** unlike `messages.ts`'s fixtures (confirmed against a real synced account during an earlier investigation), these follow eBay's long-stable, publicly documented Trading API schema for these three calls — the most heavily used and least-changed calls in the whole API. If a real response ever doesn't match, fix it the same way `messages.ts` was fixed: add a diagnostic log, get a real response, update the fixture and the parser together.

- [x] **Step 1: Write the failing tests**

Create `src/lib/integrations/ebay/listings.test.ts`:

```ts
import {
  fetchListingDetail,
  reviseListing,
  endListing,
  buildAspectsForRevise,
  conditionIdToListingCondition,
} from "./listings";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function mockXmlResponse(xml: string) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(xml),
  }) as unknown as typeof fetch;
}

describe("conditionIdToListingCondition", () => {
  it("maps New and New other to new", () => {
    expect(conditionIdToListingCondition("1000")).toBe("new");
    expect(conditionIdToListingCondition("1500")).toBe("new");
  });

  it("maps the two refurbished IDs to refurbished", () => {
    expect(conditionIdToListingCondition("2000")).toBe("refurbished");
    expect(conditionIdToListingCondition("2500")).toBe("refurbished");
  });

  it("falls back to used for anything else, including null", () => {
    expect(conditionIdToListingCondition("3000")).toBe("used");
    expect(conditionIdToListingCondition("7000")).toBe("used");
    expect(conditionIdToListingCondition(null)).toBe("used");
  });
});

describe("fetchListingDetail", () => {
  const GET_ITEM_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>
    <GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <Ack>Success</Ack>
      <Item>
        <ItemID>111222333</ItemID>
        <Title>Wireless Mouse</Title>
        <Description><![CDATA[<p>A great mouse &amp; more</p>]]></Description>
        <PrimaryCategory>
          <CategoryID>9355</CategoryID>
          <CategoryName>Cell Phones</CategoryName>
        </PrimaryCategory>
        <ConditionID>1000</ConditionID>
        <Quantity>5</Quantity>
        <SellingStatus>
          <CurrentPrice currencyID="EUR">19.99</CurrentPrice>
        </SellingStatus>
        <PictureDetails>
          <PictureURL>https://example.com/1.jpg</PictureURL>
          <PictureURL>https://example.com/2.jpg</PictureURL>
        </PictureDetails>
        <ItemSpecifics>
          <NameValueList><Name>Brand</Name><Value>Acme</Value></NameValueList>
          <NameValueList><Name>Type</Name><Value>Wireless</Value></NameValueList>
        </ItemSpecifics>
      </Item>
    </GetItemResponse>`;

  it("parses a full item into EbayListingDetail", async () => {
    mockXmlResponse(GET_ITEM_RESPONSE);

    const detail = await fetchListingDetail("token", "111222333");

    expect(detail).toEqual({
      ebayListingId: "111222333",
      title: "Wireless Mouse",
      description: "<p>A great mouse & more</p>",
      price: 19.99,
      currency: "EUR",
      quantity: 5,
      condition: "new",
      imageUrls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      categoryId: "9355",
      categoryName: "Cell Phones",
      aspects: { Brand: "Acme", Type: "Wireless" },
    });
  });

  it("collapses a multi-value NameValueList to its first value only (v1 doesn't support MULTI-cardinality aspects)", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <Item>
          <ItemID>2</ItemID>
          <Title>Multi-value aspect</Title>
          <Description></Description>
          <PrimaryCategory><CategoryID>1</CategoryID><CategoryName>Misc</CategoryName></PrimaryCategory>
          <SellingStatus><CurrentPrice currencyID="EUR">5.00</CurrentPrice></SellingStatus>
          <ItemSpecifics>
            <NameValueList><Name>Color</Name><Value>Red</Value><Value>Blue</Value></NameValueList>
          </ItemSpecifics>
        </Item>
      </GetItemResponse>`);

    const detail = await fetchListingDetail("token", "2");
    expect(detail.aspects).toEqual({ Color: "Red" });
  });

  it("defaults quantity to 1 and condition to used when absent", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <Item>
          <ItemID>1</ItemID>
          <Title>No condition or quantity</Title>
          <Description></Description>
          <PrimaryCategory><CategoryID>1</CategoryID><CategoryName>Misc</CategoryName></PrimaryCategory>
          <SellingStatus><CurrentPrice currencyID="EUR">5.00</CurrentPrice></SellingStatus>
        </Item>
      </GetItemResponse>`);

    const detail = await fetchListingDetail("token", "1");
    expect(detail.quantity).toBe(1);
    expect(detail.condition).toBe("used");
    expect(detail.imageUrls).toEqual([]);
    expect(detail.aspects).toEqual({});
  });
});

describe("buildAspectsForRevise", () => {
  it("returns undefined when the maps are identical", () => {
    expect(buildAspectsForRevise({ Brand: "Acme" }, { Brand: "Acme" })).toBeUndefined();
  });

  it("returns undefined when both are empty", () => {
    expect(buildAspectsForRevise({}, {})).toBeUndefined();
  });

  it("returns the submitted map when a value changed", () => {
    expect(buildAspectsForRevise({ Brand: "Acme" }, { Brand: "Other" })).toEqual({
      Brand: "Other",
    });
  });

  it("returns the submitted map when a key was added", () => {
    expect(buildAspectsForRevise({ Brand: "Acme" }, { Brand: "Acme", Type: "New" })).toEqual({
      Brand: "Acme",
      Type: "New",
    });
  });

  it("returns the submitted map when a key was removed", () => {
    expect(
      buildAspectsForRevise({ Brand: "Acme", Type: "New" }, { Brand: "Acme" })
    ).toEqual({ Brand: "Acme" });
  });
});

describe("reviseListing", () => {
  it("sends the complete image list and no ItemSpecifics when aspects is omitted", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <ReviseItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></ReviseItemResponse>`);

    await reviseListing("token", "111", {
      title: "New title",
      description: "New description",
      price: 25,
      quantity: 3,
      condition: "used",
      imageUrls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
    });

    const sentBody = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
    expect(sentBody).toMatch(/<PictureURL>https:\/\/example\.com\/a\.jpg<\/PictureURL>/);
    expect(sentBody).toMatch(/<PictureURL>https:\/\/example\.com\/b\.jpg<\/PictureURL>/);
    expect(sentBody).not.toMatch(/<ItemSpecifics>/);
    expect(sentBody).toMatch(/<ConditionID>3000<\/ConditionID>/);
    expect(sentBody).toMatch(/<StartPrice>25\.00<\/StartPrice>/);
  });

  it("includes ItemSpecifics when aspects is provided", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <ReviseItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></ReviseItemResponse>`);

    await reviseListing("token", "111", {
      title: "T",
      description: "D",
      price: 10,
      quantity: 1,
      condition: "new",
      imageUrls: [],
      aspects: { Brand: "Acme" },
    });

    const sentBody = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
    expect(sentBody).toMatch(
      /<ItemSpecifics><NameValueList><Name>Brand<\/Name><Value>Acme<\/Value><\/NameValueList><\/ItemSpecifics>/
    );
  });
});

describe("endListing", () => {
  it("sends an EndItem request with EndingReason NotAvailable", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <EndItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></EndItemResponse>`);

    await endListing("token", "111");

    const sentBody = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
    expect(sentBody).toMatch(/<ItemID>111<\/ItemID>/);
    expect(sentBody).toMatch(/<EndingReason>NotAvailable<\/EndingReason>/);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/integrations/ebay/listings -v`
Expected: FAIL — `fetchListingDetail`, `reviseListing`, `endListing`, `buildAspectsForRevise`, `conditionIdToListingCondition` are not exported yet.

- [x] **Step 3: Implement the functions**

In `src/lib/integrations/ebay/listings.ts`, add `escapeXml` to the existing import and append everything below the existing `fetchActiveListings` function:

```ts
import { tradingApiCall, tagText, decodeXml, escapeXml } from "./tradingApi";
import type { ListingCondition } from "@/types";
```

```ts
// ─── Condition ID mapping ───────────────────────────────────────────────────
// eBay's ConditionID enum has many more values than this app's 3-way
// ListingCondition (new/used/refurbished). Reading (ConditionID -> our enum)
// is necessarily lossy; writing (our enum -> a ConditionID) picks one
// canonical ID per bucket — editable afterward if wrong, same as the
// aspects-mapping precedent in publishPayloads.ts.
const CONDITION_ID_TO_LISTING_CONDITION: Record<string, ListingCondition> = {
  "1000": "new",
  "1500": "new",
  "2000": "refurbished",
  "2500": "refurbished",
};
const LISTING_CONDITION_TO_CONDITION_ID: Record<ListingCondition, string> = {
  new: "1000",
  refurbished: "2000",
  used: "3000",
};

export function conditionIdToListingCondition(conditionId: string | null): ListingCondition {
  return (conditionId && CONDITION_ID_TO_LISTING_CONDITION[conditionId]) ?? "used";
}

function stripCdata(raw: string): string {
  const match = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return match ? match[1] : raw;
}

// ─── GetItem (full listing detail) ──────────────────────────────────────────

export interface EbayListingDetail {
  ebayListingId: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  quantity: number;
  condition: ListingCondition;
  imageUrls: string[];
  categoryId: string;
  categoryName: string;
  aspects: Record<string, string>;
}

function buildGetItemRequest(itemId: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    `<ItemID>${itemId}</ItemID>` +
    "<DetailLevel>ReturnAll</DetailLevel>" +
    "</GetItemRequest>"
  );
}

export async function fetchListingDetail(
  accessToken: string,
  itemId: string
): Promise<EbayListingDetail> {
  const xml = await tradingApiCall("GetItem", buildGetItemRequest(itemId), accessToken);
  const item = tagText(xml, "Item") ?? "";

  const title = tagText(item, "Title");
  const descriptionRaw = tagText(item, "Description") ?? "";
  const primaryCategory = tagText(item, "PrimaryCategory") ?? "";
  const sellingStatus = tagText(item, "SellingStatus") ?? "";
  const pictureDetails = tagText(item, "PictureDetails") ?? "";
  const itemSpecifics = tagText(item, "ItemSpecifics") ?? "";
  const categoryName = tagText(primaryCategory, "CategoryName");

  const priceMatch = sellingStatus.match(
    /<CurrentPrice currencyID="([A-Z]{3})">([\d.]+)<\/CurrentPrice>/
  );

  const imageUrls = (pictureDetails.match(/<PictureURL>([\s\S]*?)<\/PictureURL>/g) ?? []).map(
    (tag) => decodeXml(tag.replace(/<\/?PictureURL>/g, ""))
  );

  const aspects: Record<string, string> = {};
  const nameValueBlocks = itemSpecifics.match(/<NameValueList>[\s\S]*?<\/NameValueList>/g) ?? [];
  for (const block of nameValueBlocks) {
    const name = tagText(block, "Name");
    const value = tagText(block, "Value");
    if (name && value) aspects[decodeXml(name)] = decodeXml(value);
  }

  return {
    ebayListingId: itemId,
    title: title ? decodeXml(title) : "",
    description: decodeXml(stripCdata(descriptionRaw)),
    price: priceMatch ? Number(priceMatch[2]) : 0,
    currency: priceMatch ? priceMatch[1] : "EUR",
    quantity: Number(tagText(item, "Quantity") ?? "1"),
    condition: conditionIdToListingCondition(tagText(item, "ConditionID")),
    imageUrls,
    categoryId: tagText(primaryCategory, "CategoryID") ?? "",
    categoryName: categoryName ? decodeXml(categoryName) : "",
    aspects,
  };
}

// ─── ReviseItem ──────────────────────────────────────────────────────────────

export interface ReviseListingInput {
  title: string;
  description: string;
  price: number;
  quantity: number;
  condition: ListingCondition;
  imageUrls: string[];
  // Omitted entirely (not an empty object) means "don't touch ItemSpecifics"
  // — see buildAspectsForRevise. Never send this unconditionally.
  aspects?: Record<string, string>;
}

// Decides whether ItemSpecifics belongs in the ReviseItem call at all.
// Returns undefined when every value matches the original (omit the field,
// per eBay's own guidance that resending item specifics unconditionally
// risks "attribute version problems"), or the submitted map when at least
// one value differs, was added, or was removed.
export function buildAspectsForRevise(
  original: Record<string, string>,
  submitted: Record<string, string>
): Record<string, string> | undefined {
  const originalKeys = Object.keys(original);
  const submittedKeys = Object.keys(submitted);
  const sameKeyCount = originalKeys.length === submittedKeys.length;
  const sameKeys = sameKeyCount && originalKeys.every((key) => key in submitted);
  const sameValues = sameKeys && originalKeys.every((key) => original[key] === submitted[key]);

  return sameValues ? undefined : submitted;
}

function buildReviseItemRequest(itemId: string, changes: ReviseListingInput): string {
  const pictureUrlsXml = changes.imageUrls
    .map((url) => `<PictureURL>${escapeXml(url)}</PictureURL>`)
    .join("");

  const itemSpecificsXml =
    changes.aspects !== undefined
      ? "<ItemSpecifics>" +
        Object.entries(changes.aspects)
          .map(
            ([name, value]) =>
              `<NameValueList><Name>${escapeXml(name)}</Name><Value>${escapeXml(value)}</Value></NameValueList>`
          )
          .join("") +
        "</ItemSpecifics>"
      : "";

  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    "<Item>" +
    `<ItemID>${itemId}</ItemID>` +
    `<Title>${escapeXml(changes.title)}</Title>` +
    `<Description><![CDATA[${changes.description}]]></Description>` +
    `<Quantity>${changes.quantity}</Quantity>` +
    `<ConditionID>${LISTING_CONDITION_TO_CONDITION_ID[changes.condition]}</ConditionID>` +
    `<StartPrice>${changes.price.toFixed(2)}</StartPrice>` +
    `<PictureDetails>${pictureUrlsXml}</PictureDetails>` +
    itemSpecificsXml +
    "</Item>" +
    "</ReviseItemRequest>"
  );
}

export async function reviseListing(
  accessToken: string,
  itemId: string,
  changes: ReviseListingInput
): Promise<void> {
  await tradingApiCall("ReviseItem", buildReviseItemRequest(itemId, changes), accessToken);
}

// ─── EndItem ─────────────────────────────────────────────────────────────────

function buildEndItemRequest(itemId: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    `<ItemID>${itemId}</ItemID>` +
    "<EndingReason>NotAvailable</EndingReason>" +
    "</EndItemRequest>"
  );
}

export async function endListing(accessToken: string, itemId: string): Promise<void> {
  await tradingApiCall("EndItem", buildEndItemRequest(itemId), accessToken);
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/integrations/ebay/listings -v`
Expected: PASS, all tests green.

- [x] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/integrations/ebay/listings.ts src/lib/integrations/ebay/listings.test.ts`
Expected: no errors.

- [x] **Step 6: Commit**

```bash
git add src/lib/integrations/ebay/listings.ts src/lib/integrations/ebay/listings.test.ts
git commit -m "feat(listings): add GetItem/ReviseItem/EndItem Trading API functions"
```

---

### Task 3: `POST /api/listings/ebay/sync` route

**Files:**
- Create: `src/app/api/listings/ebay/sync/route.ts`

**Interfaces:**
- Consumes: `fetchActiveListings` (already exists, `./listings`), `requireIntegrationAdmin` (`@/lib/integrations/authGuard`), `getConnection`/`ensureValidAccessToken` (`@/lib/integrations/tokenStore`), `ebayAdapter` (`@/lib/integrations/ebay`), `hasPermission` (`@/lib/utils/permissions`).
- Produces: `POST /api/listings/ebay/sync` → `{ imported: number, removed: number }` on success. No other task consumes this route directly (the frontend in Task 5 calls it by URL).

**Critical correctness requirement:** the upsert must never touch a row whose `origin` is already `"app"` — if eBay's active list happens to include a listing this app published, upserting over it by `ebay_listing_id` would silently blank out its `aspects`/policies/`merchant_location_key` (a `GetMyeBaySelling` summary carries none of that). Skip any fetched listing whose `ebay_listing_id` already exists as an `origin = "app"` row before upserting anything.

- [x] **Step 1: Write the route**

```ts
// src/app/api/listings/ebay/sync/route.ts
import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { fetchActiveListings } from "@/lib/integrations/ebay/listings";
import { hasPermission } from "@/lib/utils/permissions";
import type { Profile } from "@/types";

export async function POST() {
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
    console.error("[listings/ebay/sync] token refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const listings = await fetchActiveListings(accessToken);

    // Never let this sync overwrite a listing the app itself published —
    // GetMyeBaySelling's summary carries none of its aspects/policies/
    // merchant_location_key, so upserting over it would blank them out.
    const { data: appOwned, error: appOwnedError } = await client
      .from("ebay_listing_drafts")
      .select("ebay_listing_id")
      .eq("origin", "app")
      .not("ebay_listing_id", "is", null);
    if (appOwnedError) throw appOwnedError;
    const appOwnedIds = new Set((appOwned ?? []).map((r) => r.ebay_listing_id));

    const importable = listings.filter((l) => !appOwnedIds.has(l.ebayListingId));

    let imported = 0;
    if (importable.length > 0) {
      const rows = importable.map((l) => ({
        ebay_listing_id: l.ebayListingId,
        title: l.title,
        image_urls: l.imageUrl ? [l.imageUrl] : [],
        price: l.currentPrice,
        currency: l.currency,
        ebay_sku: l.sku,
        origin: "ebay_import" as const,
        status: "published" as const,
        // source_type/quantity/condition don't meaningfully apply to an
        // imported listing (GetMyeBaySelling's summary doesn't carry
        // quantity/condition at all) — these are corrected the first time
        // someone opens the listing's Edit page, which does a full GetItem
        // fetch. The Listings table never shows source_type for an
        // origin="ebay_import" row, so this default is never misleadingly
        // displayed as "Inventory".
        source_type: "inventory" as const,
        quantity: 1,
        condition: "used" as const,
        created_by: userId,
      }));

      const { error: upsertError } = await client
        .from("ebay_listing_drafts")
        .upsert(rows, { onConflict: "ebay_listing_id" });
      if (upsertError) throw upsertError;
      imported = importable.length;
    }

    // Reconcile: a previously-imported listing that's no longer in eBay's
    // active list (sold out, expired, ended in Seller Hub, or ended via
    // this app's own Delete action if its local-row cleanup ever failed)
    // gets pruned here. Scoped strictly to origin="ebay_import" — never
    // touches an app-created draft, which can legitimately be draft/failed
    // with no active eBay listing yet.
    const { data: existingImported, error: existingError } = await client
      .from("ebay_listing_drafts")
      .select("ebay_listing_id")
      .eq("origin", "ebay_import");
    if (existingError) throw existingError;

    const fetchedIds = new Set(listings.map((l) => l.ebayListingId));
    const staleIds = (existingImported ?? [])
      .map((r) => r.ebay_listing_id)
      .filter((id): id is string => id !== null && !fetchedIds.has(id));

    let removed = 0;
    if (staleIds.length > 0) {
      const { error: deleteError } = await client
        .from("ebay_listing_drafts")
        .delete()
        .eq("origin", "ebay_import")
        .in("ebay_listing_id", staleIds);
      if (deleteError) throw deleteError;
      removed = staleIds.length;
    }

    return NextResponse.json({ imported, removed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    console.error("[listings/ebay/sync] failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [x] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/api/listings/ebay/sync/route.ts`
Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add src/app/api/listings/ebay/sync/route.ts
git commit -m "feat(listings): add POST /api/listings/ebay/sync route"
```

---

### Task 4: Per-listing routes (`ebay-detail`, `revise`, `end`)

**Files:**
- Create: `src/app/api/listings/[id]/ebay-detail/route.ts`
- Create: `src/app/api/listings/[id]/revise/route.ts`
- Create: `src/app/api/listings/[id]/end/route.ts`

**Interfaces:**
- Consumes: `fetchListingDetail`, `reviseListing`, `endListing`, `buildAspectsForRevise` (Task 2, `@/lib/integrations/ebay/listings`); `requireIntegrationAdmin`, `getConnection`/`ensureValidAccessToken`, `ebayAdapter`, `hasPermission`.
- Produces: `GET /api/listings/[id]/ebay-detail` → `EbayListingDetail`; `POST /api/listings/[id]/revise` (body: `{ title, description, price, quantity, condition, imageUrls, aspects }`) → the updated `EbayListingDraft` row; `POST /api/listings/[id]/end` → `{ ok: true }`. Task 6's frontend calls all three.

- [x] **Step 1: Write `GET /api/listings/[id]/ebay-detail`**

```ts
// src/app/api/listings/[id]/ebay-detail/route.ts
import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { fetchListingDetail } from "@/lib/integrations/ebay/listings";
import { hasPermission } from "@/lib/utils/permissions";
import type { EbayListingDraft, Profile } from "@/types";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    .select("ebay_listing_id")
    .eq("id", id)
    .single<Pick<EbayListingDraft, "ebay_listing_id">>();
  if (fetchError || !draft?.ebay_listing_id) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
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
    console.error("[listings/ebay-detail] token refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const detail = await fetchListingDetail(accessToken, draft.ebay_listing_id);
    return NextResponse.json(detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch listing detail";
    console.error("[listings/ebay-detail] fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [x] **Step 2: Write `POST /api/listings/[id]/revise`**

```ts
// src/app/api/listings/[id]/revise/route.ts
import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import {
  fetchListingDetail,
  reviseListing,
  buildAspectsForRevise,
  type ReviseListingInput,
} from "@/lib/integrations/ebay/listings";
import { hasPermission } from "@/lib/utils/permissions";
import type { EbayListingDraft, Profile } from "@/types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    .select("ebay_listing_id")
    .eq("id", id)
    .single<Pick<EbayListingDraft, "ebay_listing_id">>();
  if (fetchError || !draft?.ebay_listing_id) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  let body: ReviseListingInput;
  try {
    body = (await req.json()) as ReviseListingInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
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
    console.error("[listings/revise] token refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    // Diff against a FRESH fetch, never the client-submitted "original" —
    // buildAspectsForRevise's decision is consequential enough that it
    // must not trust anything the client claims about prior state.
    const current = await fetchListingDetail(accessToken, draft.ebay_listing_id);
    const aspectsForRevise = buildAspectsForRevise(current.aspects, body.aspects ?? {});

    await reviseListing(accessToken, draft.ebay_listing_id, {
      title: body.title,
      description: body.description,
      price: body.price,
      quantity: body.quantity,
      condition: body.condition,
      imageUrls: body.imageUrls,
      aspects: aspectsForRevise,
    });

    const { data: updated, error: updateError } = await client
      .from("ebay_listing_drafts")
      .update({
        title: body.title,
        description: body.description,
        price: body.price,
        quantity: body.quantity,
        condition: body.condition,
        image_urls: body.imageUrls,
        aspects: body.aspects ?? {},
      })
      .eq("id", id)
      .select()
      .single<EbayListingDraft>();
    if (updateError) throw updateError;

    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to revise listing";
    console.error("[listings/revise] failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [x] **Step 3: Write `POST /api/listings/[id]/end`**

```ts
// src/app/api/listings/[id]/end/route.ts
import { NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getConnection, ensureValidAccessToken } from "@/lib/integrations/tokenStore";
import { ebayAdapter } from "@/lib/integrations/ebay";
import { endListing } from "@/lib/integrations/ebay/listings";
import { hasPermission } from "@/lib/utils/permissions";
import type { EbayListingDraft, Profile } from "@/types";

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
    .select("ebay_listing_id")
    .eq("id", id)
    .single<Pick<EbayListingDraft, "ebay_listing_id">>();
  if (fetchError || !draft?.ebay_listing_id) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
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
    console.error("[listings/end] token refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    await endListing(accessToken, draft.ebay_listing_id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to end listing";
    console.error("[listings/end] failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // The listing is genuinely gone from eBay at this point regardless of
  // what happens next — a failed local delete is a display-only
  // inconsistency (the next Sync's reconciliation step prunes it), not a
  // reason to tell the tenant their delete failed.
  const { error: deleteError } = await client.from("ebay_listing_drafts").delete().eq("id", id);
  if (deleteError) {
    console.error("[listings/end] local row cleanup failed:", deleteError.message);
  }

  return NextResponse.json({ ok: true });
}
```

- [x] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/api/listings/[id]/ebay-detail/route.ts src/app/api/listings/[id]/revise/route.ts src/app/api/listings/[id]/end/route.ts`
Expected: no errors.

- [x] **Step 5: Commit**

```bash
git add "src/app/api/listings/[id]/ebay-detail/route.ts" "src/app/api/listings/[id]/revise/route.ts" "src/app/api/listings/[id]/end/route.ts"
git commit -m "feat(listings): add ebay-detail, revise, and end routes"
```

---

### Task 5: "Sync from eBay" button and the list's origin-aware row rendering

**Files:**
- Modify: `src/app/dashboard/listings/page.tsx`
- Modify: `src/app/dashboard/listings/_components/ListingsTable.tsx`

**Interfaces:**
- Consumes: `POST /api/listings/ebay/sync` (Task 3); `fetchListingsPage` (existing thunk, `../_store/listingsSlice`) to refresh the table after a sync; `useToast` (`@/components/ui/Toast`).
- Produces: nothing new consumed elsewhere — this is the last piece other than Task 6's edit page, which Task 6 links to directly by route path.

- [x] **Step 1: Add the "Sync from eBay" button to `page.tsx`**

```tsx
// src/app/dashboard/listings/page.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { hasPermission } from "@/lib/utils/permissions";
import { fetchListingsPage } from "./_store/listingsSlice";
import { ListingsTable } from "./_components/ListingsTable";
import { BusinessEbayGate } from "./_components/BusinessEbayGate";

export default function ListingsPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const permissionOverrides = useAppSelector((s) => s.currentUser.profile?.permission_overrides);
  const { items, page, pageSize, total, isFetching } = useAppSelector((s) => s.listings);
  const [syncing, setSyncing] = useState(false);

  const canManage = role && hasPermission(role, "manage_listings", permissionOverrides);

  function goToPage(nextPage: number) {
    dispatch(fetchListingsPage({ page: nextPage, pageSize }));
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/listings/ebay/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      success(`Synced from eBay: ${json.imported} imported, ${json.removed} removed.`);
      dispatch(fetchListingsPage({ page: 1, pageSize }));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <BusinessEbayGate>
      <div>
        <PageHeader
          title="Listings"
          description="Publish products to eBay from Inventory or a dropship source"
          action={
            canManage && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={handleSync} disabled={syncing}>
                  <RefreshCw size={14} />
                  {syncing ? "Syncing…" : "Sync from eBay"}
                </Button>
                <Link href="/dashboard/listings/new">
                  <Button size="sm">
                    <Plus size={14} />
                    New Listing
                  </Button>
                </Link>
              </div>
            )
          }
        />

        {isFetching && (
          <div className="mb-4 text-sm text-(--color-text-muted)">Loading…</div>
        )}

        <ListingsTable listings={items} />

        <div className="mt-3">
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} />
        </div>
      </div>
    </BusinessEbayGate>
  );
}
```

- [x] **Step 2: Make the table origin-aware**

In `src/app/dashboard/listings/_components/ListingsTable.tsx`, the "Source" column currently always renders based on `source_type` — for an imported row, `source_type` is an arbitrary default (see Task 3's note) and must never be shown. The "Title" link and "Actions" column also need to route to the new edit page instead of the wizard once `status === "published"`.

```tsx
"use client";

import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/utils/currency";
import type { EbayListingDraft, ListingStatus } from "@/types";

const STATUS_VARIANTS: Record<ListingStatus, "default" | "success" | "warning" | "danger" | "info"> = {
  draft: "default",
  publishing: "info",
  published: "success",
  failed: "danger",
};

function editHref(row: EbayListingDraft): string {
  return row.status === "published"
    ? `/dashboard/listings/${row.id}/live`
    : `/dashboard/listings/${row.id}`;
}

interface Props {
  listings: EbayListingDraft[];
}

export function ListingsTable({ listings }: Props) {
  return (
    <DataTable<EbayListingDraft>
      keyField="id"
      rows={listings}
      emptyMessage="No listings yet. Click “New Listing” to create one, or “Sync from eBay” to import existing ones."
      columns={[
        {
          header: "Image",
          render: (row) =>
            row.image_urls[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.image_urls[0]} alt="" className="h-10 w-10 rounded object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded bg-(--color-surface-subtle)">
                <ImageIcon size={16} className="text-(--color-text-faint)" />
              </div>
            ),
        },
        {
          header: "Title",
          render: (row) => (
            <Link href={editHref(row)} className="font-medium text-(--color-primary) hover:underline">
              {row.title}
            </Link>
          ),
        },
        {
          header: "Source",
          render: (row) =>
            row.origin === "ebay_import" ? (
              <Badge label="Imported" variant="default" />
            ) : row.source_type === "inventory" ? (
              <Badge label="Inventory" variant="info" />
            ) : (
              <Badge label={row.source_platform ?? "Dropship"} variant="default" />
            ),
        },
        {
          header: "Price",
          render: (row) => formatCurrency(row.price, row.currency),
          sortValue: (row) => row.price,
        },
        {
          header: "Status",
          render: (row) => <Badge label={row.status} variant={STATUS_VARIANTS[row.status]} />,
        },
        {
          header: "Actions",
          render: (row) =>
            row.status === "published" ? (
              <Link href={editHref(row)} className="text-sm text-(--color-primary) hover:underline">
                Edit →
              </Link>
            ) : (
              <Link href={editHref(row)} className="text-sm text-(--color-primary) hover:underline">
                {row.status === "failed" ? "Retry" : "Edit"} →
              </Link>
            ),
        },
      ]}
    />
  );
}
```

Note: the "View on eBay →" external-link action that used to appear for published rows is dropped from the Actions column here, since the new edit page (Task 6) is a strictly more useful destination for a published listing than an external link — it shows everything the old link showed (via `ebay_listing_id`) plus lets you act on it.

- [x] **Step 3: Type-check, lint, and run the existing listings test suite**

Run: `npx tsc --noEmit && npx eslint src/app/dashboard/listings/page.tsx src/app/dashboard/listings/_components/ListingsTable.tsx`
Expected: no errors.

Run: `npx jest dashboard/listings`
Expected: all passing (no test in this suite renders `ListingsTable`/`page.tsx` directly today, so this is a smoke check that nothing else broke).

- [x] **Step 4: Commit**

```bash
git add src/app/dashboard/listings/page.tsx src/app/dashboard/listings/_components/ListingsTable.tsx
git commit -m "feat(listings): add Sync from eBay action and origin-aware table"
```

---

### Task 6: Live listing edit page (Trading API)

**Files:**
- Create: `src/app/dashboard/listings/[id]/live/page.tsx`
- Create: `src/app/dashboard/listings/_components/EditLiveListing.tsx`

**Interfaces:**
- Consumes: `GET /api/listings/[id]/ebay-detail`, `POST /api/listings/[id]/revise`, `POST /api/listings/[id]/end` (Task 4); `GET /api/listings/ebay/aspects?categoryId=` (existing route, reused as-is); `DeleteConfirmModal` (`@/components/modals/DeleteConfirmModal`); `updateListingDraft`/`removeListingDraft` (existing actions, `../_store/listingsSlice`); `writeAuditLog` (`@/lib/utils/audit`); `BusinessEbayGate` (existing).
- Produces: the route `/dashboard/listings/[id]/live`, linked from Task 5's table.

- [x] **Step 1: Write the thin route wrapper**

```tsx
// src/app/dashboard/listings/[id]/live/page.tsx
"use client";

import { use } from "react";
import { EditLiveListing } from "../../_components/EditLiveListing";
import { BusinessEbayGate } from "../../_components/BusinessEbayGate";

export default function LiveListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <BusinessEbayGate>
      <EditLiveListing draftId={id} />
    </BusinessEbayGate>
  );
}
```

- [x] **Step 2: Write `EditLiveListing.tsx`**

This mirrors `AspectsStep.tsx`'s fetch-and-render pattern for item specifics, and `PoliciesStep.tsx`'s inline-form pattern, but against the Trading API detail shape instead of a wizard draft.

```tsx
// src/app/dashboard/listings/_components/EditLiveListing.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { useAppDispatch } from "@/store/hooks";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { updateListingDraft, removeListingDraft } from "../_store/listingsSlice";
import type { ListingCondition } from "@/types";

interface LiveDetail {
  ebayListingId: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  quantity: number;
  condition: ListingCondition;
  imageUrls: string[];
  categoryId: string;
  categoryName: string;
  aspects: Record<string, string>;
}

interface RequiredAspect {
  name: string;
  values: string[];
  isProductIdentifier: boolean;
}

interface Props {
  draftId: string;
}

export function EditLiveListing({ draftId }: Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();

  const [detail, setDetail] = useState<LiveDetail | null>(null);
  const [required, setRequired] = useState<RequiredAspect[] | null>(null);
  const [notApplicableText, setNotApplicableText] = useState("Does not apply");
  const [aspects, setAspects] = useState<Record<string, string>>({});
  const [imageUrlsText, setImageUrlsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    Promise.resolve().then(async () => {
      try {
        const res = await fetch(`/api/listings/${draftId}/ebay-detail`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load listing");
        setDetail(json);
        setAspects(json.aspects);
        setImageUrlsText(json.imageUrls.join("\n"));

        const aspectsRes = await fetch(
          `/api/listings/ebay/aspects?categoryId=${encodeURIComponent(json.categoryId)}`
        );
        const aspectsJson = await aspectsRes.json();
        if (aspectsRes.ok) {
          setRequired(aspectsJson.aspects);
          setNotApplicableText(aspectsJson.notApplicableText);
        } else {
          setRequired([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load listing");
      } finally {
        setLoading(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  function setField<K extends keyof LiveDetail>(key: K, value: LiveDetail[K]) {
    setDetail((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave() {
    if (!detail) return;
    setSaving(true);
    setError(null);
    try {
      const imageUrls = imageUrlsText
        .split("\n")
        .map((url) => url.trim())
        .filter(Boolean);

      const res = await fetch(`/api/listings/${draftId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: detail.title,
          description: detail.description,
          price: detail.price,
          quantity: detail.quantity,
          condition: detail.condition,
          imageUrls,
          aspects,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save changes");

      dispatch(updateListingDraft(json));

      const supabase = await createTenantClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await writeAuditLog(supabase, {
          userId: user.id,
          userEmail: user.email ?? "",
          action: "update",
          entityType: "sale",
          entityId: draftId,
          metadata: { title: detail.title, live: true },
        }).then((log) => log && dispatch(addAuditLog(log)));
      }

      success("Listing updated on eBay.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(reason: string) {
    try {
      const res = await fetch(`/api/listings/${draftId}/end`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to end listing");

      dispatch(removeListingDraft(draftId));

      const supabase = await createTenantClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await writeAuditLog(supabase, {
          userId: user.id,
          userEmail: user.email ?? "",
          action: "delete",
          entityType: "sale",
          entityId: draftId,
          metadata: { title: detail?.title, reason },
        }).then((log) => log && dispatch(addAuditLog(log)));
      }

      success("Listing ended on eBay.");
      router.push("/dashboard/listings");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to end listing");
    } finally {
      setDeleteOpen(false);
    }
  }

  if (loading) return <div className="text-sm text-(--color-text-muted)">Loading…</div>;
  if (error && !detail) return <p className="text-sm text-(--color-danger-text)">{error}</p>;
  if (!detail) return null;

  return (
    <div>
      <PageHeader title="Edit Listing" description="Changes save directly to your live eBay listing" />

      {error && (
        <div className="mb-4 rounded-(--radius-btn) bg-(--color-danger-bg) border border-red-200 px-4 py-3 text-sm text-(--color-danger-text)">
          {error}
        </div>
      )}

      <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6 space-y-4">
        <Field label="Category">
          <Input value={detail.categoryName || detail.categoryId} disabled />
        </Field>

        <Field label="Title" required>
          <Input value={detail.title} onChange={(e) => setField("title", e.target.value)} />
        </Field>

        <Field label="Description" required>
          <Textarea
            value={detail.description}
            onChange={(e) => setField("description", e.target.value)}
          />
        </Field>

        <Field label="Price" required>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={detail.price}
            onChange={(e) => setField("price", Number(e.target.value))}
          />
        </Field>

        <Field label="Quantity" required>
          <Input
            type="number"
            min="1"
            value={detail.quantity}
            onChange={(e) => setField("quantity", Number(e.target.value))}
          />
        </Field>

        <Field label="Condition" required>
          <Select
            value={detail.condition}
            onChange={(e) => setField("condition", e.target.value as ListingCondition)}
          >
            <option value="new">New</option>
            <option value="used">Used</option>
            <option value="refurbished">Refurbished</option>
          </Select>
        </Field>

        <Field label="Image URLs (one per line)" required>
          <Textarea value={imageUrlsText} onChange={(e) => setImageUrlsText(e.target.value)} />
        </Field>

        {(required ?? []).map((aspect) => {
          const value = aspects[aspect.name] ?? "";
          const isNotApplicable = value === notApplicableText;

          if (aspect.isProductIdentifier && aspect.values.length === 0) {
            return (
              <Field key={aspect.name} label={aspect.name} required>
                <Input
                  value={isNotApplicable ? "" : value}
                  disabled={isNotApplicable}
                  onChange={(e) => setAspects((prev) => ({ ...prev, [aspect.name]: e.target.value }))}
                />
                <label className="mt-1.5 flex items-center gap-2 text-xs text-(--color-text-muted)">
                  <input
                    type="checkbox"
                    checked={isNotApplicable}
                    onChange={(e) =>
                      setAspects((prev) => ({
                        ...prev,
                        [aspect.name]: e.target.checked ? notApplicableText : "",
                      }))
                    }
                  />
                  This product doesn&apos;t have a {aspect.name}
                </label>
              </Field>
            );
          }

          return (
            <Field key={aspect.name} label={aspect.name} required>
              {aspect.values.length > 0 ? (
                <Select
                  value={value}
                  onChange={(e) => setAspects((prev) => ({ ...prev, [aspect.name]: e.target.value }))}
                >
                  <option value="">Select…</option>
                  {aspect.values.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={value}
                  onChange={(e) => setAspects((prev) => ({ ...prev, [aspect.name]: e.target.value }))}
                />
              )}
            </Field>
          );
        })}

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="text-sm font-medium text-(--color-danger-text) hover:underline"
          >
            Delete listing
          </button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      <DeleteConfirmModal
        open={deleteOpen}
        title="End this eBay listing?"
        description="This ends the listing on eBay immediately. It cannot be undone — you would need to create a new listing to sell this item again."
        confirmLabel="Delete"
        confirmingLabel="Ending…"
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
```

- [x] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/dashboard/listings/_components/EditLiveListing.tsx "src/app/dashboard/listings/[id]/live/page.tsx"`
Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add "src/app/dashboard/listings/[id]/live/page.tsx" src/app/dashboard/listings/_components/EditLiveListing.tsx
git commit -m "feat(listings): add live listing edit page (Trading API)"
```

---

## Final wiring check (unnumbered — run after all 6 tasks)

- [x] **Step 1: Full verification suite**

Run, in order:
```bash
npx jest
npx tsc --noEmit
npx eslint src
npx next build
```
Expected: all tests pass, no type errors, no new lint errors beyond the pre-existing 16 warnings, and the build succeeds with the new routes listed exactly once:
`POST /api/listings/ebay/sync`, `GET /api/listings/[id]/ebay-detail`, `POST /api/listings/[id]/revise`, `POST /api/listings/[id]/end`, and the new page `GET /dashboard/listings/[id]/live`.

- [x] **Step 2: Update `dashboard/listings/CLAUDE.md`**

Add a new paragraph after the "Publish flow" section describing: the `origin` column and what it means; the "Sync from eBay" action and its reconciliation behavior; the split between the wizard (draft/failed, Inventory API) and the new live-edit page (published, Trading API); the new files (`listings.ts`'s additions, the four new routes, `EditLiveListing.tsx`).

- [x] **Step 3: Update `dashboard/listings/SKILL.md`**

Add a gotcha entry for: the sync-must-never-overwrite-`origin=app` correctness requirement (Task 3); the `ItemSpecifics`/`PictureDetails` replace-vs-diff semantics (Task 2); the fact that `fetchListingDetail`'s GetItem fixtures are based on documented schema, not a confirmed-live account, unlike `messages.ts`'s.

- [ ] **Step 4: Manual verification**

**Before this**: migration `038_ebay_listing_drafts_origin.sql` must be applied to the live Supabase project (Supabase SQL Editor, Project B — same manual-apply process as every other migration in this repo) — the sync route's upsert has no unique index to target without it. See `supabase/SKILL.md`'s file-map table (rows for 036/037/038 added during the final-review fix wave).

Since route handlers and the network-calling parts of `listings.ts` are untested per this project's convention, ask the user to manually verify against a real eBay test-mode (or real) account:
1. Click "Sync from eBay" on `/dashboard/listings` — confirm imported listings appear with an "Imported" badge.
2. Open one — confirm it lands on `/dashboard/listings/[id]/live`, not the wizard.
3. Edit the title/price and Save — confirm the change appears on the actual eBay listing.
4. Click Delete, confirm with a reason — confirm the listing is ended on eBay and disappears from the table.
5. Re-run Sync — confirm it doesn't re-import the just-ended listing, and confirm an app-created published listing (if any exist) is untouched by Sync.

- [x] **Step 5: Commit the docs**

```bash
git add src/app/dashboard/listings/CLAUDE.md src/app/dashboard/listings/SKILL.md
git commit -m "docs(listings): document eBay sync/edit/delete feature"
```
