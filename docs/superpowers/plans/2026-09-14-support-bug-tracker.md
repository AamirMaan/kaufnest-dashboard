# Support & Bug Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/dashboard/support` — a tenant-scoped bug tracker where users report issues that become Trello cards, and where card movement and team replies flow back into the app.

**Architecture:** Reports live in the control plane (Project A, `control` schema) because support is a cross-tenant vendor inbox and the Trello webhook carries no tenant JWT. The browser never talks to Trello: the form posts `multipart/form-data` to a Next.js route, which creates the card and uploads screenshots. A signed Trello webhook writes status and `@customer` comments back, and inserts a bell notification into the reporting tenant's schema with a service-role client.

**Tech Stack:** Next.js App Router, Supabase (two projects), Redux Toolkit, Trello REST API, Jest (ts-jest, node environment), Tailwind v4 with `var(--color-*)` tokens.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-14-support-bug-tracker-design.md`. Every decision there applies here.
- **Branch:** work on `feat/support-bug-tracker` (already created from `main`). Never commit to `main`.
- **Never query `public.*`;** never hardcode a tenant schema name — read it from `user.app_metadata.tenant_schema`.
- **`createControlClient` and everything in `src/lib/support/` are server-only** — never imported from a `"use client"` file. The one exception is `src/app/dashboard/support/_lib/attachmentRules.ts`, which is deliberately pure and shared by both sides.
- **Never write `control.tenants.plan` or `status`** — Stripe's webhook owns those. This feature only reads them.
- **No `any`, no `@ts-ignore`, no `console.log`** — the verifier reports all three. `console.error` in a route's catch block is fine and used throughout the codebase.
- **Form conventions (AGENTS.md)** apply in full to `ReportIssueModal`: real `<form id>`, `required` on both `<Field>` and the control, submit button `type="submit" form="report-issue-form"`, `disabled={saving || !isFormValid}`, busy label while in flight, toast on success and failure.
- **Do not run `npx tsc --noEmit` or `npm run lint` mid-task** — `.husky/pre-commit` runs both on every commit. Do run the focused `npx jest <path>` for what you just changed.
- **Do not start a dev server or curl routes.** Verification is unit tests plus, at the end, a manual pass by the user.
- **File-size caps** (refines the spec's "5 MB"): Vercel caps a serverless request body at 4.5 MB, so the limits are **3 files, 4 MB total, images only**. This is the single source of truth; `attachmentRules.ts` encodes it and both the modal and the routes import it.
- **Trello labels are not used** (refines the spec's `idLabels` note): the tenant is identified by a `[slug]` prefix on the card title and a line in the card description. No label map, no per-tenant Trello config.
- **Every task ends with a commit.** Docs (`CLAUDE.md`, `SKILL.md`) ship in Task 15, except where a task says otherwise.

---

### Task 1: Control-plane schema and domain types

**Files:**
- Create: `supabase/control-plane/011_bug_reports.sql`
- Modify: `src/types/index.ts` (append after the `NotificationRead` interface, ~line 222; extend `NotificationType` at line 191 and `NotificationCategory` at line 197)
- Modify: `src/lib/utils/notifications.ts:70-75` (`NOTIFICATION_LABELS`)

**Interfaces:**
- Consumes: nothing.
- Produces: `BugReport`, `BugReportReply`, `BugAttachment`, `BugReportType`, `BugSeverity`, `BugReportStatus` from `@/types`; the `support.status_changed` and `support.replied` notification types.

- [ ] **Step 1: Write the control-plane migration**

Create `supabase/control-plane/011_bug_reports.sql`. Follow `007_tenant_ai_usage.sql`'s header style — these files are run by hand in the Project A SQL editor.

```sql
-- supabase/control-plane/011_bug_reports.sql
-- ============================================================
-- In-app support / bug tracker.
-- Run this in the Supabase SQL editor for PROJECT A (kaufnest-control).
--
-- Reports live here, not in tenant schemas: support is a cross-tenant vendor
-- inbox, and the Trello webhook arrives with no tenant JWT to resolve. Tenant
-- users never read these tables directly — /api/support/reports filters by the
-- caller's tenant_id server-side (control tables are unreachable from the
-- browser by design).
-- ============================================================

create table if not exists control.bug_reports (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references control.tenants(id) on delete cascade,
  -- Project B auth user id. Deliberately no FK: auth lives in a different
  -- database, so cross-project referential integrity is unavailable.
  reporter_user_id uuid not null,
  reporter_email   text not null,
  type             text not null check (type in ('bug','feature','question')),
  severity         text not null check (severity in ('low','normal','high','critical')),
  title            text not null,
  description      text not null,
  status           text not null default 'reported'
                     check (status in ('reported','in_progress','fixed','wont_fix')),
  page_url         text,
  context          jsonb,
  -- [{ id, name, mime, bytes }] — Trello attachment metadata only. The bytes
  -- live on Trello; we never store the file.
  attachments      jsonb not null default '[]'::jsonb,
  trello_card_id   text,
  trello_card_url  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_synced_at   timestamptz
);

create table if not exists control.bug_report_replies (
  id                uuid primary key default gen_random_uuid(),
  report_id         uuid not null references control.bug_reports(id) on delete cascade,
  body              text not null,
  author            text,
  -- Idempotency key: Trello redelivers webhook actions, and a replay must not
  -- duplicate a reply.
  trello_comment_id text unique,
  created_at        timestamptz not null default now()
);

create index if not exists idx_bug_reports_tenant
  on control.bug_reports (tenant_id, created_at desc);
create index if not exists idx_bug_reports_status
  on control.bug_reports (status);
create index if not exists idx_bug_reports_card
  on control.bug_reports (trello_card_id);
create index if not exists idx_bug_report_replies_report
  on control.bug_report_replies (report_id, created_at);

-- Service-role key bypasses RLS; this blocks anon/authenticated by default,
-- matching control.tenants and control.tenant_ai_usage.
alter table control.bug_reports        enable row level security;
alter table control.bug_report_replies enable row level security;
```

- [ ] **Step 2: Add the domain types**

Append to `src/types/index.ts`, after the `NotificationRead` interface:

```ts
// ─── Support / Bug Tracker ────────────────────────────────────────────────────

export type BugReportType = "bug" | "feature" | "question";
export type BugSeverity = "low" | "normal" | "high" | "critical";
export type BugReportStatus = "reported" | "in_progress" | "fixed" | "wont_fix";

/** Trello attachment metadata. The file itself never touches our storage. */
export interface BugAttachment {
  id: string;
  name: string;
  mime: string;
  bytes: number;
}

export interface BugReportReply {
  id: string;
  report_id: string;
  body: string;
  author: string | null;
  created_at: string;
}

export interface BugReport {
  id: string;
  tenant_id: string;
  reporter_user_id: string;
  reporter_email: string;
  type: BugReportType;
  severity: BugSeverity;
  title: string;
  description: string;
  status: BugReportStatus;
  page_url: string | null;
  context: Record<string, unknown> | null;
  attachments: BugAttachment[];
  /** Null when the Trello card could not be created — see the orphan flow. */
  trello_card_id: string | null;
  trello_card_url: string | null;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
  /** Joined by /api/support/reports; absent on optimistic client inserts. */
  replies?: BugReportReply[];
}
```

- [ ] **Step 3: Extend the notification types**

In `src/types/index.ts`, line 191 onward:

```ts
export type NotificationType =
  | "sale.created"
  | "purchase.created"
  | "product.low_stock"
  | "message.received"
  | "support.status_changed"
  | "support.replied";

export type NotificationCategory =
  | "orders"
  | "purchases"
  | "inventory"
  | "messages"
  | "support";
```

`NOTIFICATION_LABELS` in `src/lib/utils/notifications.ts` is typed `Record<NotificationType, string>`, so this change breaks the build until you extend it — that is the intent:

```ts
export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  "sale.created": "Orders",
  "purchase.created": "Purchases",
  "product.low_stock": "Inventory",
  "message.received": "Messages",
  "support.status_changed": "Support",
  "support.replied": "Support",
};
```

- [ ] **Step 4: Apply the migration**

This one step is the user's, not yours — control-plane migrations are run by hand. Tell them: *"Run `supabase/control-plane/011_bug_reports.sql` in the Project A (kaufnest-control) SQL editor before Task 7 is tested end-to-end."* Do not attempt to apply it yourself.

- [ ] **Step 5: Commit**

```bash
git add supabase/control-plane/011_bug_reports.sql src/types/index.ts src/lib/utils/notifications.ts
git commit -m "feat(support): control-plane bug report tables and domain types"
```

The pre-commit hook runs `tsc --noEmit`; a missing `NOTIFICATION_LABELS` entry fails it here.

---

### Task 2: Trello config and status mapping

**Files:**
- Create: `src/lib/support/config.ts`
- Test: `src/lib/support/config.test.ts`

**Interfaces:**
- Consumes: `BugReportStatus` from `@/types`.
- Produces: `trelloEnv(): TrelloEnv`, `statusForList(listId: string, map: Record<string, BugReportStatus>): BugReportStatus`, `listIdForStatus(status, map): string | null`, `type TrelloEnv`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/support/config.test.ts
import { statusForList, listIdForStatus, parseStatusMap } from "./config";

describe("parseStatusMap", () => {
  it("parses a JSON list-id → status map", () => {
    expect(parseStatusMap('{"abc":"reported","def":"fixed"}')).toEqual({
      abc: "reported",
      def: "fixed",
    });
  });

  it("drops entries whose value is not a known status", () => {
    expect(parseStatusMap('{"abc":"reported","def":"nonsense"}')).toEqual({
      abc: "reported",
    });
  });

  it("returns an empty map for malformed JSON rather than throwing", () => {
    expect(parseStatusMap("not json")).toEqual({});
    expect(parseStatusMap(undefined)).toEqual({});
  });
});

describe("statusForList", () => {
  const map = { l1: "reported", l2: "fixed" } as const;

  it("maps a known list id to its status", () => {
    expect(statusForList("l2", { ...map })).toBe("fixed");
  });

  it("falls back to in_progress for an unknown list", () => {
    expect(statusForList("l9", { ...map })).toBe("in_progress");
  });
});

describe("listIdForStatus", () => {
  it("finds the first list mapped to a status", () => {
    expect(listIdForStatus("fixed", { l1: "reported", l2: "fixed" })).toBe("l2");
  });

  it("returns null when no list maps to that status", () => {
    expect(listIdForStatus("wont_fix", { l1: "reported" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/lib/support/config.test.ts`
Expected: FAIL — `Cannot find module './config'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/support/config.ts
import type { BugReportStatus } from "@/types";

/**
 * Trello configuration, all env, none in the DB.
 * Server-only — never import this from a "use client" file.
 */
export interface TrelloEnv {
  key: string;
  token: string;
  secret: string;
  boardId: string;
  intakeListId: string;
  statusMap: Record<string, BugReportStatus>;
  callbackUrl: string;
}

const KNOWN_STATUSES: BugReportStatus[] = ["reported", "in_progress", "fixed", "wont_fix"];

/**
 * A Trello list this app has never heard of maps to `in_progress`, not an
 * error: the support team must be free to reorganise the board without
 * breaking what customers see.
 */
export const FALLBACK_STATUS: BugReportStatus = "in_progress";

export function parseStatusMap(raw: string | undefined): Record<string, BugReportStatus> {
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};

  const out: Record<string, BugReportStatus> = {};
  for (const [listId, status] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof status === "string" && KNOWN_STATUSES.includes(status as BugReportStatus)) {
      out[listId] = status as BugReportStatus;
    }
  }
  return out;
}

export function statusForList(
  listId: string,
  map: Record<string, BugReportStatus>
): BugReportStatus {
  return map[listId] ?? FALLBACK_STATUS;
}

export function listIdForStatus(
  status: BugReportStatus,
  map: Record<string, BugReportStatus>
): string | null {
  const found = Object.entries(map).find(([, value]) => value === status);
  return found ? found[0] : null;
}

/** Throws if a required variable is missing — a route returning 500 with a
 *  clear server log beats silently posting to the wrong board. */
export function trelloEnv(): TrelloEnv {
  const required = {
    key: process.env.TRELLO_API_KEY,
    token: process.env.TRELLO_API_TOKEN,
    secret: process.env.TRELLO_API_SECRET,
    boardId: process.env.TRELLO_BOARD_ID,
    intakeListId: process.env.TRELLO_INTAKE_LIST_ID,
    callbackUrl: process.env.TRELLO_WEBHOOK_CALLBACK_URL,
  };

  for (const [name, value] of Object.entries(required)) {
    if (!value) throw new Error(`Trello config missing: ${name}`);
  }

  return {
    key: required.key!,
    token: required.token!,
    secret: required.secret!,
    boardId: required.boardId!,
    intakeListId: required.intakeListId!,
    callbackUrl: required.callbackUrl!,
    statusMap: parseStatusMap(process.env.TRELLO_LIST_STATUS_MAP),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/lib/support/config.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/support/config.ts src/lib/support/config.test.ts
git commit -m "feat(support): Trello config and list-to-status mapping"
```

---

### Task 3: Card description rendering and reply parsing

**Files:**
- Create: `src/lib/support/cardContent.ts`
- Test: `src/lib/support/cardContent.test.ts`

**Interfaces:**
- Consumes: `BugReport` from `@/types`.
- Produces: `renderCardDescription(input: CardDescriptionInput): string`, `renderCardTitle(slug: string, title: string): string`, `parseCustomerReply(text: string): string | null`, `CUSTOMER_MARKER`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/support/cardContent.test.ts
import { renderCardDescription, renderCardTitle, parseCustomerReply } from "./cardContent";

describe("renderCardTitle", () => {
  it("prefixes the tenant slug so the board is scannable", () => {
    expect(renderCardTitle("kaufnest", "Invoice PDF is blank")).toBe(
      "[kaufnest] Invoice PDF is blank"
    );
  });
});

describe("renderCardDescription", () => {
  const input = {
    description: "The PDF downloads but every page is empty.",
    type: "bug" as const,
    severity: "high" as const,
    tenantSlug: "kaufnest",
    plan: "pro",
    reporterEmail: "ana@example.com",
    pageUrl: "https://app.example.com/dashboard/sales/42",
    userAgent: "Mozilla/5.0 (Macintosh)",
  };

  it("leads with the user's own words", () => {
    expect(renderCardDescription(input)).toMatch(
      /^The PDF downloads but every page is empty\./
    );
  });

  it("includes every context field the triager needs", () => {
    const out = renderCardDescription(input);
    expect(out).toContain("**Tenant:** kaufnest (pro)");
    expect(out).toContain("**Reporter:** ana@example.com");
    expect(out).toContain("**Type:** bug / **Severity:** high");
    expect(out).toContain("https://app.example.com/dashboard/sales/42");
    expect(out).toContain("Mozilla/5.0 (Macintosh)");
  });

  it("omits the page line when no URL was captured", () => {
    const out = renderCardDescription({ ...input, pageUrl: null });
    expect(out).not.toContain("**Page:**");
  });
});

describe("parseCustomerReply", () => {
  it("strips the marker and surrounding whitespace", () => {
    expect(parseCustomerReply("@customer Fixed in today's release.")).toBe(
      "Fixed in today's release."
    );
  });

  it("is case-insensitive about the marker", () => {
    expect(parseCustomerReply("@Customer  thanks for the report")).toBe(
      "thanks for the report"
    );
  });

  it("returns null for internal chatter", () => {
    expect(parseCustomerReply("looks like a caching bug, assigning to Sam")).toBeNull();
  });

  it("returns null for a marker with no body", () => {
    expect(parseCustomerReply("@customer   ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/lib/support/cardContent.test.ts`
Expected: FAIL — `Cannot find module './cardContent'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/support/cardContent.ts
import type { BugReportType, BugSeverity } from "@/types";

/**
 * A Trello comment is shown to the customer only when it starts with this
 * marker. Everything else on the card is internal triage chatter.
 */
export const CUSTOMER_MARKER = "@customer";

export interface CardDescriptionInput {
  description: string;
  type: BugReportType;
  severity: BugSeverity;
  tenantSlug: string;
  plan: string;
  reporterEmail: string;
  pageUrl: string | null;
  userAgent: string | null;
}

export function renderCardTitle(tenantSlug: string, title: string): string {
  return `[${tenantSlug}] ${title}`;
}

/** The card body a triager reads. User's words first, context underneath. */
export function renderCardDescription(input: CardDescriptionInput): string {
  const lines = [
    input.description.trim(),
    "",
    "---",
    `**Tenant:** ${input.tenantSlug} (${input.plan})`,
    `**Reporter:** ${input.reporterEmail}`,
    `**Type:** ${input.type} / **Severity:** ${input.severity}`,
  ];

  if (input.pageUrl) lines.push(`**Page:** ${input.pageUrl}`);
  if (input.userAgent) lines.push(`**Browser:** ${input.userAgent}`);

  lines.push("", "_Reported from Boughtopia. Reply with `@customer …` to answer the reporter._");

  return lines.join("\n");
}

/** Returns the customer-visible body, or null if the comment is internal. */
export function parseCustomerReply(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith(CUSTOMER_MARKER)) return null;

  const body = trimmed.slice(CUSTOMER_MARKER.length).trim();
  return body.length > 0 ? body : null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/lib/support/cardContent.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/support/cardContent.ts src/lib/support/cardContent.test.ts
git commit -m "feat(support): Trello card rendering and @customer reply parsing"
```

---

### Task 4: Webhook signature verification

**Files:**
- Create: `src/lib/support/signature.ts`
- Test: `src/lib/support/signature.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `verifyWebhookSignature(rawBody: string, header: string | null, secret: string, callbackUrl: string): boolean`.

- [ ] **Step 1: Write the failing test**

Trello signs `body + callbackURL` with HMAC-SHA1, base64-encoded, in the `x-trello-webhook` header. The test computes the expected value the same way the verifier must.

```ts
// src/lib/support/signature.test.ts
import { createHmac } from "crypto";
import { verifyWebhookSignature } from "./signature";

const SECRET = "trello-app-secret";
const CALLBACK = "https://app.example.com/api/support/trello-webhook";
const BODY = JSON.stringify({ action: { type: "updateCard" } });

function sign(body: string, callback: string, secret = SECRET): string {
  return createHmac("sha1", secret).update(body + callback).digest("base64");
}

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed payload", () => {
    expect(verifyWebhookSignature(BODY, sign(BODY, CALLBACK), SECRET, CALLBACK)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = sign(BODY, CALLBACK);
    const tampered = JSON.stringify({ action: { type: "deleteCard" } });
    expect(verifyWebhookSignature(tampered, sig, SECRET, CALLBACK)).toBe(false);
  });

  it("rejects a signature computed for a different callback URL", () => {
    const sig = sign(BODY, "https://evil.example.com/hook");
    expect(verifyWebhookSignature(BODY, sig, SECRET, CALLBACK)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(
      verifyWebhookSignature(BODY, sign(BODY, CALLBACK, "wrong"), SECRET, CALLBACK)
    ).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyWebhookSignature(BODY, null, SECRET, CALLBACK)).toBe(false);
  });

  it("rejects a malformed header without throwing", () => {
    expect(verifyWebhookSignature(BODY, "!!!not-base64!!!", SECRET, CALLBACK)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/lib/support/signature.test.ts`
Expected: FAIL — `Cannot find module './signature'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/support/signature.ts
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Trello signs `requestBody + callbackURL` with HMAC-SHA1 keyed on the app
 * secret, base64-encoded, and sends it as `x-trello-webhook`. The callback URL
 * is part of the signed material, so a signature captured from one deployment
 * cannot be replayed against another.
 *
 * Server-only. `rawBody` must be the exact bytes received — parse the JSON
 * only after this returns true.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  callbackUrl: string
): boolean {
  if (!header) return false;

  const expected = createHmac("sha1", secret).update(rawBody + callbackUrl).digest();

  let received: Buffer;
  try {
    received = Buffer.from(header, "base64");
  } catch {
    return false;
  }

  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/lib/support/signature.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/support/signature.ts src/lib/support/signature.test.ts
git commit -m "feat(support): verify Trello webhook HMAC signatures"
```

---

### Task 5: Trello HTTP adapter

**Files:**
- Create: `src/lib/support/trello.ts`
- Test: `src/lib/support/trello.test.ts`

**Interfaces:**
- Consumes: `trelloEnv`, `TrelloEnv` from `./config`; `BugAttachment` from `@/types`.
- Produces: `createCard({ env, listId, name, desc })` → `{ id: string; url: string }`; `attachFile({ env, cardId, file })` → `BugAttachment`; `downloadAttachment({ env, cardId, attachmentId, fileName })` → `{ body: ArrayBuffer; contentType: string }`; `fetchCard({ env, cardId })` → `{ idList: string; url: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/support/trello.test.ts
import { createCard, attachFile, fetchCard, downloadAttachment } from "./trello";
import type { TrelloEnv } from "./config";

const env: TrelloEnv = {
  key: "k", token: "t", secret: "s",
  boardId: "b", intakeListId: "list-intake",
  statusMap: {}, callbackUrl: "https://app.example.com/api/support/trello-webhook",
};

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function mockJson(body: unknown, ok = true, status = 200) {
  const fn = jest.fn().mockResolvedValue({
    ok, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("createCard", () => {
  it("posts to the intake list and returns id and short url", async () => {
    const fn = mockJson({ id: "card-1", shortUrl: "https://trello.com/c/abc" });

    const card = await createCard({ env, listId: "list-intake", name: "[t] Bug", desc: "body" });

    expect(card).toEqual({ id: "card-1", url: "https://trello.com/c/abc" });
    const [url, init] = fn.mock.calls[0];
    expect(url).toContain("https://api.trello.com/1/cards");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({ idList: "list-intake", name: "[t] Bug", desc: "body" });
  });

  it("throws a readable error when Trello rejects the call", async () => {
    mockJson({ message: "invalid id" }, false, 400);
    await expect(
      createCard({ env, listId: "nope", name: "x", desc: "y" })
    ).rejects.toThrow(/Trello createCard failed \(400\)/);
  });
});

describe("attachFile", () => {
  it("uploads multipart and returns attachment metadata", async () => {
    const fn = mockJson({ id: "att-1", name: "shot.png", mimeType: "image/png", bytes: 1234 });
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });

    const meta = await attachFile({ env, cardId: "card-1", file });

    expect(meta).toEqual({ id: "att-1", name: "shot.png", mime: "image/png", bytes: 1234 });
    const [url, init] = fn.mock.calls[0];
    expect(url).toContain("/1/cards/card-1/attachments");
    expect(init.body).toBeInstanceOf(FormData);
  });
});

describe("fetchCard", () => {
  it("returns the card's current list", async () => {
    mockJson({ idList: "list-done", shortUrl: "https://trello.com/c/abc" });
    await expect(fetchCard({ env, cardId: "card-1" })).resolves.toEqual({
      idList: "list-done",
      url: "https://trello.com/c/abc",
    });
  });
});

describe("downloadAttachment", () => {
  it("authenticates with the OAuth header, not query params", async () => {
    const fn = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
      headers: new Headers({ "content-type": "image/png" }),
    });
    global.fetch = fn as unknown as typeof fetch;

    const out = await downloadAttachment({
      env, cardId: "card-1", attachmentId: "att-1", fileName: "shot.png",
    });

    expect(out.contentType).toBe("image/png");
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe(
      "https://api.trello.com/1/cards/card-1/attachments/att-1/download/shot.png"
    );
    expect(url).not.toContain("key=");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'OAuth oauth_consumer_key="k", oauth_token="t"'
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/lib/support/trello.test.ts`
Expected: FAIL — `Cannot find module './trello'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/support/trello.ts
import type { BugAttachment } from "@/types";
import type { TrelloEnv } from "./config";

const API = "https://api.trello.com/1";

function auth(env: TrelloEnv): string {
  return `key=${encodeURIComponent(env.key)}&token=${encodeURIComponent(env.token)}`;
}

async function fail(res: Response, label: string): Promise<never> {
  const detail = await res.text().catch(() => "");
  throw new Error(`Trello ${label} failed (${res.status}): ${detail.slice(0, 200)}`);
}

export async function createCard(args: {
  env: TrelloEnv;
  listId: string;
  name: string;
  desc: string;
}): Promise<{ id: string; url: string }> {
  const { env, listId, name, desc } = args;

  const res = await fetch(`${API}/cards?${auth(env)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idList: listId, name, desc, pos: "top" }),
  });
  if (!res.ok) await fail(res, "createCard");

  const card = (await res.json()) as { id: string; shortUrl: string };
  return { id: card.id, url: card.shortUrl };
}

export async function attachFile(args: {
  env: TrelloEnv;
  cardId: string;
  file: File;
}): Promise<BugAttachment> {
  const { env, cardId, file } = args;

  const form = new FormData();
  form.append("file", file, file.name);

  const res = await fetch(`${API}/cards/${cardId}/attachments?${auth(env)}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) await fail(res, "attachFile");

  const att = (await res.json()) as {
    id: string;
    name: string;
    mimeType: string | null;
    bytes: number | null;
  };
  return {
    id: att.id,
    name: att.name,
    mime: att.mimeType ?? file.type,
    bytes: att.bytes ?? file.size,
  };
}

export async function fetchCard(args: {
  env: TrelloEnv;
  cardId: string;
}): Promise<{ idList: string; url: string }> {
  const { env, cardId } = args;

  const res = await fetch(`${API}/cards/${cardId}?fields=idList,shortUrl&${auth(env)}`);
  if (!res.ok) await fail(res, "fetchCard");

  const card = (await res.json()) as { idList: string; shortUrl: string };
  return { idList: card.idList, url: card.shortUrl };
}

/**
 * Attachment downloads are the one Trello endpoint that will NOT accept
 * key/token as query parameters — it returns 401 unless the credentials are
 * in an OAuth Authorization header. Do not "simplify" this to `auth(env)`.
 */
export async function downloadAttachment(args: {
  env: TrelloEnv;
  cardId: string;
  attachmentId: string;
  fileName: string;
}): Promise<{ body: ArrayBuffer; contentType: string }> {
  const { env, cardId, attachmentId, fileName } = args;

  const res = await fetch(
    `${API}/cards/${cardId}/attachments/${attachmentId}/download/${encodeURIComponent(fileName)}`,
    {
      headers: {
        Authorization: `OAuth oauth_consumer_key="${env.key}", oauth_token="${env.token}"`,
      },
    }
  );
  if (!res.ok) await fail(res, "downloadAttachment");

  return {
    body: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/lib/support/trello.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/support/trello.ts src/lib/support/trello.test.ts
git commit -m "feat(support): Trello REST adapter for cards and attachments"
```

---

### Task 6: Shared attachment validation

**Files:**
- Create: `src/app/dashboard/support/_lib/attachmentRules.ts`
- Test: `src/app/dashboard/support/_lib/attachmentRules.test.ts`

**Interfaces:**
- Consumes: nothing. **This module must stay dependency-free** — it is imported by both a Client Component and a server route, so it may not import anything server-only.
- Produces: `MAX_FILES`, `MAX_TOTAL_BYTES`, `ALLOWED_MIME_TYPES`, `validateAttachments(files: AttachmentCandidate[]): string | null`, `type AttachmentCandidate = { name: string; size: number; type: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/dashboard/support/_lib/attachmentRules.test.ts
import {
  validateAttachments,
  MAX_FILES,
  MAX_TOTAL_BYTES,
} from "./attachmentRules";

const png = (name: string, size: number) => ({ name, size, type: "image/png" });

describe("validateAttachments", () => {
  it("accepts no files at all — a screenshot is optional", () => {
    expect(validateAttachments([])).toBeNull();
  });

  it("accepts up to the file limit", () => {
    const files = Array.from({ length: MAX_FILES }, (_, i) => png(`s${i}.png`, 1000));
    expect(validateAttachments(files)).toBeNull();
  });

  it("rejects more than the file limit", () => {
    const files = Array.from({ length: MAX_FILES + 1 }, (_, i) => png(`s${i}.png`, 1000));
    expect(validateAttachments(files)).toBe("You can attach at most 3 screenshots.");
  });

  it("rejects a non-image file by name", () => {
    expect(
      validateAttachments([{ name: "notes.pdf", size: 100, type: "application/pdf" }])
    ).toBe("notes.pdf is not an image. Attach a PNG, JPEG, WebP or GIF.");
  });

  it("rejects a set whose total exceeds the request-body cap", () => {
    expect(validateAttachments([png("big.png", MAX_TOTAL_BYTES + 1)])).toBe(
      "Screenshots total more than 4 MB. Attach fewer or smaller images."
    );
  });

  it("measures the total across files, not each file alone", () => {
    const half = Math.ceil(MAX_TOTAL_BYTES / 2) + 1;
    expect(validateAttachments([png("a.png", half), png("b.png", half)])).toContain(
      "total more than 4 MB"
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/app/dashboard/support/_lib/attachmentRules.test.ts`
Expected: FAIL — `Cannot find module './attachmentRules'`.

- [ ] **Step 3: Implement**

```ts
// src/app/dashboard/support/_lib/attachmentRules.ts
/**
 * Shared by the report modal and the API routes so the two can never disagree
 * about what is acceptable. Deliberately dependency-free: this is the one
 * module in the support feature imported from both the client and the server.
 *
 * The 4 MB total is not arbitrary — Vercel caps a serverless request body at
 * 4.5 MB, and the form posts the files inline as multipart. Raising it means
 * building a chunked upload path, not changing this constant.
 */
export const MAX_FILES = 3;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export interface AttachmentCandidate {
  name: string;
  size: number;
  type: string;
}

/** Returns a user-facing error message, or null when the set is acceptable. */
export function validateAttachments(files: AttachmentCandidate[]): string | null {
  if (files.length > MAX_FILES) {
    return `You can attach at most ${MAX_FILES} screenshots.`;
  }

  const offender = files.find((f) => !ALLOWED_MIME_TYPES.includes(f.type));
  if (offender) {
    return `${offender.name} is not an image. Attach a PNG, JPEG, WebP or GIF.`;
  }

  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    const mb = Math.round(MAX_TOTAL_BYTES / (1024 * 1024));
    return `Screenshots total more than ${mb} MB. Attach fewer or smaller images.`;
  }

  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/app/dashboard/support/_lib/attachmentRules.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/support/_lib/attachmentRules.ts src/app/dashboard/support/_lib/attachmentRules.test.ts
git commit -m "feat(support): shared screenshot validation rules"
```

---

### Task 7: Submit route — POST /api/support/report

**Files:**
- Create: `src/app/api/support/report/route.ts`
- Create: `src/lib/support/tenantContext.ts`
- Test: `src/lib/support/tenantContext.test.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`, `createControlClient` from `@/lib/supabase/control`, `trelloEnv` from `./config`, `createCard`/`attachFile` from `./trello`, `renderCardTitle`/`renderCardDescription` from `./cardContent`, `validateAttachments` from the support feature's `_lib`.
- Produces: `resolveTenantContext(user)` → `{ tenantId, slug, plan, schema }`; the route returns `{ report: BugReport; warning?: string }` with status 201.

- [ ] **Step 1: Write the failing test for the pure part**

The route itself is integration-shaped; the piece worth unit-testing is the shape check that turns a control-plane row into a tenant context.

```ts
// src/lib/support/tenantContext.test.ts
import { tenantContextFrom } from "./tenantContext";

describe("tenantContextFrom", () => {
  it("maps a control tenant row to a context", () => {
    expect(
      tenantContextFrom({ id: "t-1", slug: "kaufnest", plan: "pro" }, "tenant_kaufnest")
    ).toEqual({ tenantId: "t-1", slug: "kaufnest", plan: "pro", schema: "tenant_kaufnest" });
  });

  it("falls back to the schema name when the tenant has no slug", () => {
    expect(
      tenantContextFrom({ id: "t-1", slug: null, plan: "starter" }, "tenant_acme").slug
    ).toBe("tenant_acme");
  });

  it("defaults an absent plan to 'trial' rather than printing 'null' on the card", () => {
    expect(
      tenantContextFrom({ id: "t-1", slug: "acme", plan: null }, "tenant_acme").plan
    ).toBe("trial");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/lib/support/tenantContext.test.ts`
Expected: FAIL — `Cannot find module './tenantContext'`.

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/support/tenantContext.ts
export interface TenantContext {
  tenantId: string;
  slug: string;
  plan: string;
  schema: string;
}

export interface ControlTenantRow {
  id: string;
  slug: string | null;
  plan: string | null;
}

/** Server-only. Normalises a control.tenants row for card rendering. */
export function tenantContextFrom(row: ControlTenantRow, schema: string): TenantContext {
  return {
    tenantId: row.id,
    slug: row.slug ?? schema,
    plan: row.plan ?? "trial",
    schema,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx jest src/lib/support/tenantContext.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the route**

```ts
// src/app/api/support/report/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { trelloEnv } from "@/lib/support/config";
import { createCard, attachFile } from "@/lib/support/trello";
import { renderCardTitle, renderCardDescription } from "@/lib/support/cardContent";
import { tenantContextFrom, type ControlTenantRow } from "@/lib/support/tenantContext";
import { validateAttachments } from "@/app/dashboard/support/_lib/attachmentRules";
import type { BugAttachment, BugReport, BugReportType, BugSeverity } from "@/types";

// FormData parsing and the Trello upload both need the Node runtime.
export const runtime = "nodejs";

const TYPES: BugReportType[] = ["bug", "feature", "question"];
const SEVERITIES: BugSeverity[] = ["low", "normal", "high", "critical"];

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json({ error: "No tenant schema on user" }, { status: 400 });
  }

  const form = await req.formData();
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const type = String(form.get("type") ?? "") as BugReportType;
  const severity = String(form.get("severity") ?? "") as BugSeverity;
  const pageUrl = String(form.get("pageUrl") ?? "").trim() || null;
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (!title || description.length < 20 || !TYPES.includes(type) || !SEVERITIES.includes(severity)) {
    return NextResponse.json(
      { error: "Title, a description of at least 20 characters, type and severity are required." },
      { status: 400 }
    );
  }

  const fileError = validateAttachments(
    files.map((f) => ({ name: f.name, size: f.size, type: f.type }))
  );
  if (fileError) {
    return NextResponse.json({ error: fileError }, { status: 400 });
  }

  const control = createControlClient();
  const { data: tenantRow, error: tenantError } = await control
    .schema("control")
    .from("tenants")
    .select("id, slug, plan")
    .eq("schema_name", tenantSchema)
    .single<ControlTenantRow>();

  if (tenantError || !tenantRow) {
    console.error("[support/report] tenant lookup failed:", tenantError?.message);
    return NextResponse.json({ error: "Could not identify your account." }, { status: 500 });
  }

  const tenant = tenantContextFrom(tenantRow, tenantSchema);

  // Insert FIRST: the report must survive a Trello outage.
  const { data: report, error: insertError } = await control
    .schema("control")
    .from("bug_reports")
    .insert({
      tenant_id: tenant.tenantId,
      reporter_user_id: user.id,
      reporter_email: user.email ?? "unknown",
      type,
      severity,
      title,
      description,
      page_url: pageUrl,
      context: {
        plan: tenant.plan,
        tenant_slug: tenant.slug,
        user_agent: req.headers.get("user-agent"),
      },
    })
    .select("*")
    .single<BugReport>();

  if (insertError || !report) {
    console.error("[support/report] insert failed:", insertError?.message);
    return NextResponse.json({ error: "Could not save your report." }, { status: 500 });
  }

  // Trello is best-effort from here on — never fail the request on its account.
  let warning: string | undefined;
  try {
    const env = trelloEnv();
    const card = await createCard({
      env,
      listId: env.intakeListId,
      name: renderCardTitle(tenant.slug, title),
      desc: renderCardDescription({
        description,
        type,
        severity,
        tenantSlug: tenant.slug,
        plan: tenant.plan,
        reporterEmail: user.email ?? "unknown",
        pageUrl,
        userAgent: req.headers.get("user-agent"),
      }),
    });

    const attachments: BugAttachment[] = [];
    for (const file of files) {
      try {
        attachments.push(await attachFile({ env, cardId: card.id, file }));
      } catch (err) {
        console.error("[support/report] attachment upload failed:", err);
        warning = "Your report was sent, but a screenshot could not be attached. You can add it from the report.";
      }
    }

    await control
      .schema("control")
      .from("bug_reports")
      .update({
        trello_card_id: card.id,
        trello_card_url: card.url,
        attachments,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", report.id);

    report.trello_card_id = card.id;
    report.trello_card_url = card.url;
    report.attachments = attachments;
  } catch (err) {
    console.error("[support/report] Trello card creation failed:", err);
    warning = "Your report was saved, but our tracker is unreachable right now. The team will still see it.";
  }

  return NextResponse.json({ report, warning }, { status: 201 });
}
```

- [ ] **Step 6: Run the support tests**

Run: `npx jest src/lib/support src/app/dashboard/support`
Expected: PASS — all suites from Tasks 2–7.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/support/report/route.ts src/lib/support/tenantContext.ts src/lib/support/tenantContext.test.ts
git commit -m "feat(support): submit route creating a report and Trello card"
```

---

### Task 8: List route — GET /api/support/reports

**Files:**
- Create: `src/app/api/support/reports/route.ts`
- Create: `src/lib/support/authorizeReport.ts`
- Test: `src/lib/support/authorizeReport.test.ts`

**Interfaces:**
- Consumes: `createClient`, `createControlClient`.
- Produces: `assertReportVisible(report, tenantId)` → `boolean`; the route returns `{ reports: BugReport[] }` where each report carries its `replies` array.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/support/authorizeReport.test.ts
import { assertReportVisible, attachReplies } from "./authorizeReport";
import type { BugReport, BugReportReply } from "@/types";

const report = { id: "r-1", tenant_id: "t-1" } as BugReport;

describe("assertReportVisible", () => {
  it("allows a report belonging to the caller's tenant", () => {
    expect(assertReportVisible(report, "t-1")).toBe(true);
  });

  it("denies a report belonging to another tenant", () => {
    expect(assertReportVisible(report, "t-2")).toBe(false);
  });

  it("denies when the report is missing", () => {
    expect(assertReportVisible(null, "t-1")).toBe(false);
  });
});

describe("attachReplies", () => {
  it("groups replies onto their report, oldest first", () => {
    const reports = [{ id: "r-1" }, { id: "r-2" }] as BugReport[];
    const replies = [
      { id: "x", report_id: "r-1", body: "later", author: null, created_at: "2026-09-10T10:00:00Z" },
      { id: "y", report_id: "r-1", body: "earlier", author: null, created_at: "2026-09-09T10:00:00Z" },
    ] as BugReportReply[];

    const out = attachReplies(reports, replies);

    expect(out[0].replies?.map((r) => r.body)).toEqual(["earlier", "later"]);
    expect(out[1].replies).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/lib/support/authorizeReport.test.ts`
Expected: FAIL — `Cannot find module './authorizeReport'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/support/authorizeReport.ts
import type { BugReport, BugReportReply } from "@/types";

/**
 * Control-plane rows carry no RLS for tenant users, so every read path must
 * make this check explicitly. Callers turn `false` into a 404, never a 403 —
 * confirming that an id exists is itself a leak.
 */
export function assertReportVisible(
  report: Pick<BugReport, "tenant_id"> | null,
  tenantId: string
): boolean {
  return !!report && report.tenant_id === tenantId;
}

export function attachReplies(reports: BugReport[], replies: BugReportReply[]): BugReport[] {
  const byReport = new Map<string, BugReportReply[]>();
  for (const reply of replies) {
    const list = byReport.get(reply.report_id) ?? [];
    list.push(reply);
    byReport.set(reply.report_id, list);
  }

  for (const list of byReport.values()) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  return reports.map((r) => ({ ...r, replies: byReport.get(r.id) ?? [] }));
}
```

- [ ] **Step 4: Run the test**

Run: `npx jest src/lib/support/authorizeReport.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the route**

```ts
// src/app/api/support/reports/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { attachReplies } from "@/lib/support/authorizeReport";
import type { BugReport, BugReportReply } from "@/types";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json({ error: "No tenant schema on user" }, { status: 400 });
  }

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("id")
    .eq("schema_name", tenantSchema)
    .single<{ id: string }>();

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const { data: reports, error } = await control
    .schema("control")
    .from("bug_reports")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .returns<BugReport[]>();

  if (error) {
    console.error("[support/reports] list failed:", error.message);
    return NextResponse.json({ error: "Could not load your reports." }, { status: 500 });
  }

  const ids = (reports ?? []).map((r) => r.id);
  const { data: replies } = ids.length
    ? await control
        .schema("control")
        .from("bug_report_replies")
        .select("*")
        .in("report_id", ids)
        .returns<BugReportReply[]>()
    : { data: [] as BugReportReply[] };

  return NextResponse.json({ reports: attachReplies(reports ?? [], replies ?? []) });
}
```

- [ ] **Step 6: Run the support tests**

Run: `npx jest src/lib/support`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/support/reports/route.ts src/lib/support/authorizeReport.ts src/lib/support/authorizeReport.test.ts
git commit -m "feat(support): tenant-scoped reports list route"
```

---

### Task 9: Attachment routes — add and proxy

**Files:**
- Create: `src/app/api/support/reports/[id]/attachments/route.ts`
- Create: `src/app/api/support/reports/[id]/attachments/[attachmentId]/route.ts`

**Interfaces:**
- Consumes: `assertReportVisible`, `validateAttachments`, `attachFile`, `downloadAttachment`, `trelloEnv`.
- Produces: POST returns `{ attachments: BugAttachment[] }`; GET streams the file bytes.

**Note on route params:** this Next.js version awaits `params` in route handlers — check an existing dynamic route (`src/app/api/listings/[id]/publish/route.ts`) and copy its exact signature rather than assuming.

- [ ] **Step 1: Write the add-attachment route**

```ts
// src/app/api/support/reports/[id]/attachments/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { trelloEnv } from "@/lib/support/config";
import { attachFile } from "@/lib/support/trello";
import { assertReportVisible } from "@/lib/support/authorizeReport";
import { validateAttachments } from "@/app/dashboard/support/_lib/attachmentRules";
import type { BugAttachment, BugReport } from "@/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json({ error: "No tenant schema on user" }, { status: 400 });
  }

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control").from("tenants").select("id")
    .eq("schema_name", tenantSchema).single<{ id: string }>();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const { data: report } = await control
    .schema("control").from("bug_reports").select("*")
    .eq("id", id).single<BugReport>();

  // Another tenant's id answers 404, never 403 — a 403 confirms it exists.
  if (!assertReportVisible(report, tenant.id) || !report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
  if (!report.trello_card_id) {
    return NextResponse.json(
      { error: "This report isn't in the tracker yet. Try again shortly." },
      { status: 409 }
    );
  }

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const existing = report.attachments ?? [];

  const fileError = validateAttachments(
    [...existing.map((a) => ({ name: a.name, size: a.bytes, type: a.mime })),
     ...files.map((f) => ({ name: f.name, size: f.size, type: f.type }))]
  );
  if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });

  const env = trelloEnv();
  const added: BugAttachment[] = [];
  try {
    for (const file of files) {
      added.push(await attachFile({ env, cardId: report.trello_card_id, file }));
    }
  } catch (err) {
    console.error("[support/attachments] upload failed:", err);
    return NextResponse.json({ error: "Could not attach the screenshot." }, { status: 502 });
  }

  const attachments = [...existing, ...added];
  await control
    .schema("control").from("bug_reports")
    .update({ attachments, updated_at: new Date().toISOString() })
    .eq("id", report.id);

  return NextResponse.json({ attachments });
}
```

- [ ] **Step 2: Write the proxy route**

```ts
// src/app/api/support/reports/[id]/attachments/[attachmentId]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { trelloEnv } from "@/lib/support/config";
import { downloadAttachment } from "@/lib/support/trello";
import { assertReportVisible } from "@/lib/support/authorizeReport";
import type { BugReport } from "@/types";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id, attachmentId } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json({ error: "No tenant schema on user" }, { status: 400 });
  }

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control").from("tenants").select("id")
    .eq("schema_name", tenantSchema).single<{ id: string }>();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const { data: report } = await control
    .schema("control").from("bug_reports").select("*")
    .eq("id", id).single<BugReport>();

  if (!assertReportVisible(report, tenant.id) || !report?.trello_card_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = (report.attachments ?? []).find((a) => a.id === attachmentId);
  if (!meta) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const file = await downloadAttachment({
      env: trelloEnv(),
      cardId: report.trello_card_id,
      attachmentId,
      fileName: meta.name,
    });

    return new NextResponse(file.body, {
      headers: {
        "Content-Type": file.contentType,
        // Private: this is one tenant's screenshot, never a shared CDN object.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[support/attachments] download failed:", err);
    return NextResponse.json({ error: "Could not load the screenshot." }, { status: 502 });
  }
}
```

- [ ] **Step 3: Run the support tests**

Run: `npx jest src/lib/support src/app/dashboard/support`
Expected: PASS — no new tests here; this confirms nothing regressed.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/support/reports/[id]"
git commit -m "feat(support): add-screenshot route and tenant-guarded attachment proxy"
```

---

### Task 10: Trello webhook and reporter notification

**Files:**
- Create: `src/app/api/support/trello-webhook/route.ts`
- Create: `src/lib/support/webhookActions.ts`
- Create: `src/lib/support/notify.ts`
- Test: `src/lib/support/webhookActions.test.ts`

**Interfaces:**
- Consumes: `verifyWebhookSignature`, `statusForList`, `parseCustomerReply`, `trelloEnv`, `createServiceClientForTenant` from `@/lib/supabase/server`.
- Produces: `interpretAction(action, statusMap)` → `{ kind: "status"; cardId; status } | { kind: "reply"; cardId; commentId; body; author } | { kind: "ignore" }`; `notifyReporter({ schema, report, kind, detail })`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/support/webhookActions.test.ts
import { interpretAction } from "./webhookActions";

const statusMap = { "list-done": "fixed", "list-doing": "in_progress" } as const;

describe("interpretAction", () => {
  it("reads a card move as a status change", () => {
    expect(
      interpretAction(
        {
          type: "updateCard",
          id: "a-1",
          data: { card: { id: "card-1" }, listAfter: { id: "list-done" } },
        },
        { ...statusMap }
      )
    ).toEqual({ kind: "status", cardId: "card-1", status: "fixed" });
  });

  it("falls back to in_progress for an unmapped list", () => {
    expect(
      interpretAction(
        { type: "updateCard", id: "a-2", data: { card: { id: "c" }, listAfter: { id: "unknown" } } },
        { ...statusMap }
      )
    ).toEqual({ kind: "status", cardId: "c", status: "in_progress" });
  });

  it("ignores a card edit that did not move lists", () => {
    expect(
      interpretAction(
        { type: "updateCard", id: "a-3", data: { card: { id: "c" }, old: { name: "before" } } },
        { ...statusMap }
      )
    ).toEqual({ kind: "ignore" });
  });

  it("reads an @customer comment as a reply", () => {
    expect(
      interpretAction(
        {
          type: "commentCard",
          id: "comment-9",
          data: { card: { id: "card-1" }, text: "@customer shipping a fix today" },
          memberCreator: { fullName: "Sam" },
        },
        { ...statusMap }
      )
    ).toEqual({
      kind: "reply",
      cardId: "card-1",
      commentId: "comment-9",
      body: "shipping a fix today",
      author: "Sam",
    });
  });

  it("ignores an internal comment", () => {
    expect(
      interpretAction(
        { type: "commentCard", id: "c-1", data: { card: { id: "x" }, text: "assigning to Sam" } },
        { ...statusMap }
      )
    ).toEqual({ kind: "ignore" });
  });

  it("ignores unrelated action types", () => {
    expect(
      interpretAction({ type: "addMemberToCard", id: "m-1", data: {} }, { ...statusMap })
    ).toEqual({ kind: "ignore" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/lib/support/webhookActions.test.ts`
Expected: FAIL — `Cannot find module './webhookActions'`.

- [ ] **Step 3: Implement the interpreter**

```ts
// src/lib/support/webhookActions.ts
import type { BugReportStatus } from "@/types";
import { statusForList } from "./config";
import { parseCustomerReply } from "./cardContent";

export interface TrelloAction {
  type: string;
  id: string;
  data: {
    card?: { id: string };
    listAfter?: { id: string };
    text?: string;
    old?: Record<string, unknown>;
  };
  memberCreator?: { fullName?: string };
}

export type InterpretedAction =
  | { kind: "status"; cardId: string; status: BugReportStatus }
  | { kind: "reply"; cardId: string; commentId: string; body: string; author: string | null }
  | { kind: "ignore" };

/**
 * Trello sends far more action types than this feature cares about, and
 * redelivers them. Anything unrecognised is `ignore` — the route answers 200
 * so Trello stops retrying.
 */
export function interpretAction(
  action: TrelloAction,
  statusMap: Record<string, BugReportStatus>
): InterpretedAction {
  const cardId = action.data.card?.id;
  if (!cardId) return { kind: "ignore" };

  if (action.type === "updateCard" && action.data.listAfter?.id) {
    return { kind: "status", cardId, status: statusForList(action.data.listAfter.id, statusMap) };
  }

  if (action.type === "commentCard" && typeof action.data.text === "string") {
    const body = parseCustomerReply(action.data.text);
    if (!body) return { kind: "ignore" };
    return {
      kind: "reply",
      cardId,
      commentId: action.id,
      body,
      author: action.memberCreator?.fullName ?? null,
    };
  }

  return { kind: "ignore" };
}
```

- [ ] **Step 4: Run the test**

Run: `npx jest src/lib/support/webhookActions.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Implement the notifier**

```ts
// src/lib/support/notify.ts
import { createServiceClientForTenant } from "@/lib/supabase/server";
import type { BugReport, NotificationType, UserRole } from "@/types";

const STATUS_WORDS: Record<string, string> = {
  reported: "reported",
  in_progress: "in progress",
  fixed: "fixed",
  wont_fix: "closed as won't fix",
};

/**
 * Writes a bell notification into the reporting tenant's schema.
 *
 * Two things here are load-bearing:
 *  - `actor_id` is null. `isUnread()` suppresses notifications caused by the
 *    current user, so stamping the reporter's id would hide the update from
 *    the one person who asked for it. The Boughtopia team is external to the
 *    tenant, exactly like an inbound buyer message.
 *  - The service-role key bypasses RLS, which is why this can insert at all —
 *    `028_notifications.sql` deliberately grants `authenticated` no insert
 *    policy so users cannot forge notifications. That invariant still holds.
 */
export async function notifyReporter(args: {
  schema: string;
  report: BugReport;
  reporterRole: UserRole | null;
  kind: "status" | "reply";
  detail: string;
}): Promise<void> {
  const { schema, report, reporterRole, kind, detail } = args;

  const roles = Array.from(
    new Set<UserRole>([...(reporterRole ? [reporterRole] : []), "admin", "super_admin"])
  );

  const type: NotificationType =
    kind === "status" ? "support.status_changed" : "support.replied";

  const title =
    kind === "status"
      ? `Your report is ${STATUS_WORDS[report.status] ?? report.status}`
      : "Support replied to your report";

  const supabase = createServiceClientForTenant(schema);
  const { error } = await supabase.from("notifications").insert({
    type,
    category: "support",
    entity_type: "bug_report",
    entity_id: report.id,
    title,
    body: detail.slice(0, 500),
    link: "/dashboard/support",
    payload: { report_id: report.id, status: report.status, title: report.title },
    actor_id: null,
    visible_to_roles: roles,
    required_permission: null,
  });

  if (error) {
    // A missing notification must not fail the webhook — Trello would retry
    // the whole action and duplicate the reply.
    console.error("[support/notify] insert failed:", error.message);
  }
}
```

- [ ] **Step 6: Implement the webhook route**

```ts
// src/app/api/support/trello-webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";
import { createServiceClientForTenant } from "@/lib/supabase/server";
import { trelloEnv } from "@/lib/support/config";
import { verifyWebhookSignature } from "@/lib/support/signature";
import { interpretAction, type TrelloAction } from "@/lib/support/webhookActions";
import { notifyReporter } from "@/lib/support/notify";
import type { BugReport, UserRole } from "@/types";

export const runtime = "nodejs";

/** Trello HEADs the callback URL when the webhook is registered. */
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

export async function POST(req: NextRequest) {
  const env = trelloEnv();
  const raw = await req.text();

  if (!verifyWebhookSignature(raw, req.headers.get("x-trello-webhook"), env.secret, env.callbackUrl)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let action: TrelloAction;
  try {
    action = (JSON.parse(raw) as { action: TrelloAction }).action;
  } catch {
    return NextResponse.json({ ok: true });
  }
  if (!action) return NextResponse.json({ ok: true });

  const interpreted = interpretAction(action, env.statusMap);
  if (interpreted.kind === "ignore") return NextResponse.json({ ok: true });

  const control = createControlClient();
  const { data: report } = await control
    .schema("control").from("bug_reports").select("*")
    .eq("trello_card_id", interpreted.cardId).maybeSingle<BugReport>();

  // A card created by hand on the board has no report — nothing to do.
  if (!report) return NextResponse.json({ ok: true });

  const { data: tenant } = await control
    .schema("control").from("tenants").select("schema_name")
    .eq("id", report.tenant_id).single<{ schema_name: string }>();
  if (!tenant) return NextResponse.json({ ok: true });

  let detail: string;

  if (interpreted.kind === "status") {
    if (report.status === interpreted.status) return NextResponse.json({ ok: true });

    const { error } = await control
      .schema("control").from("bug_reports")
      .update({
        status: interpreted.status,
        updated_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", report.id);

    if (error) {
      console.error("[support/webhook] status update failed:", error.message);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    report.status = interpreted.status;
    detail = report.title;
  } else {
    // trello_comment_id is unique: a redelivered comment is a no-op insert.
    const { error } = await control
      .schema("control").from("bug_report_replies")
      .insert({
        report_id: report.id,
        body: interpreted.body,
        author: interpreted.author,
        trello_comment_id: interpreted.commentId,
      });

    if (error) {
      // 23505 = unique violation = Trello replayed this comment. Not an error.
      if (error.code === "23505") return NextResponse.json({ ok: true });
      console.error("[support/webhook] reply insert failed:", error.message);
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }

    detail = interpreted.body;
  }

  const tenantDb = createServiceClientForTenant(tenant.schema_name);
  const { data: profile } = await tenantDb
    .from("profiles").select("role").eq("id", report.reporter_user_id)
    .maybeSingle<{ role: UserRole }>();

  await notifyReporter({
    schema: tenant.schema_name,
    report,
    reporterRole: profile?.role ?? null,
    kind: interpreted.kind,
    detail,
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Run the support tests**

Run: `npx jest src/lib/support`
Expected: PASS — all suites.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/support/trello-webhook src/lib/support/webhookActions.ts src/lib/support/webhookActions.test.ts src/lib/support/notify.ts
git commit -m "feat(support): Trello webhook applying status, replies and notifications"
```

---

### Task 11: Support Redux slice

**Files:**
- Create: `src/app/dashboard/support/_store/supportSlice.ts`
- Test: `src/app/dashboard/support/_store/supportSlice.test.ts`
- Modify: `src/store/store.ts` (import + `support: supportSlice.reducer`)

**Interfaces:**
- Consumes: `BugReport` from `@/types`; the routes from Tasks 7–8.
- Produces: `supportSlice`, `fetchReports`, `submitReport`, `selectReport`, `SupportState`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/dashboard/support/_store/supportSlice.test.ts
import { supportSlice, fetchReports, submitReport } from "./supportSlice";
import type { BugReport } from "@/types";

const { reducer, actions } = supportSlice;

function report(overrides: Partial<BugReport> = {}): BugReport {
  return {
    id: "r-1", tenant_id: "t-1", reporter_user_id: "u-1", reporter_email: "a@b.c",
    type: "bug", severity: "normal", title: "Broken", description: "It broke badly",
    status: "reported", page_url: null, context: null, attachments: [],
    trello_card_id: "card-1", trello_card_url: "https://trello.com/c/x",
    created_at: "2026-09-14T10:00:00Z", updated_at: "2026-09-14T10:00:00Z",
    last_synced_at: null, replies: [],
    ...overrides,
  };
}

describe("supportSlice", () => {
  it("starts empty and unloaded", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state).toMatchObject({ items: [], loaded: false, isFetching: false });
  });

  it("stores reports on a successful fetch", () => {
    const state = reducer(undefined, {
      type: fetchReports.fulfilled.type,
      payload: [report(), report({ id: "r-2" })],
    });
    expect(state.items).toHaveLength(2);
    expect(state.loaded).toBe(true);
    expect(state.isFetching).toBe(false);
  });

  it("marks fetching while the request is in flight", () => {
    const state = reducer(undefined, { type: fetchReports.pending.type });
    expect(state.isFetching).toBe(true);
  });

  it("records the error message on a failed fetch and stops fetching", () => {
    const state = reducer(undefined, {
      type: fetchReports.rejected.type,
      error: { message: "Could not load your reports." },
    });
    expect(state.error).toBe("Could not load your reports.");
    expect(state.isFetching).toBe(false);
  });

  it("puts a newly submitted report at the top of the list", () => {
    const existing = reducer(undefined, {
      type: fetchReports.fulfilled.type,
      payload: [report({ id: "old", created_at: "2026-09-01T10:00:00Z" })],
    });
    const state = reducer(existing, {
      type: submitReport.fulfilled.type,
      payload: { report: report({ id: "new" }) },
    });
    expect(state.items[0].id).toBe("new");
    expect(state.items).toHaveLength(2);
  });

  it("tracks the selected report id", () => {
    const state = reducer(undefined, actions.selectReport("r-9"));
    expect(state.selectedId).toBe("r-9");
  });

  it("clears the selection", () => {
    const selected = reducer(undefined, actions.selectReport("r-9"));
    expect(reducer(selected, actions.selectReport(null)).selectedId).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/app/dashboard/support/_store/supportSlice.test.ts`
Expected: FAIL — `Cannot find module './supportSlice'`.

- [ ] **Step 3: Implement**

```ts
// src/app/dashboard/support/_store/supportSlice.ts
import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { BugReport } from "@/types";

interface SupportState {
  items: BugReport[];
  loaded: boolean;
  isFetching: boolean;
  isSubmitting: boolean;
  selectedId: string | null;
  error: string | null;
}

const initialState: SupportState = {
  items: [],
  loaded: false,
  isFetching: false,
  isSubmitting: false,
  selectedId: null,
  error: null,
};

/**
 * Reads through the API route, not Supabase directly: bug reports live in the
 * control plane, which the browser cannot reach by design.
 */
export const fetchReports = createAsyncThunk("support/fetch", async () => {
  const res = await fetch("/api/support/reports");
  const body = (await res.json()) as { reports?: BugReport[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? "Could not load your reports.");
  return body.reports ?? [];
});

/** Posts multipart form data — the browser never holds Trello credentials. */
export const submitReport = createAsyncThunk("support/submit", async (form: FormData) => {
  const res = await fetch("/api/support/report", { method: "POST", body: form });
  const body = (await res.json()) as { report?: BugReport; warning?: string; error?: string };
  if (!res.ok || !body.report) throw new Error(body.error ?? "Could not send your report.");
  return { report: body.report, warning: body.warning };
});

export const supportSlice = createSlice({
  name: "support",
  initialState,
  reducers: {
    selectReport(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchReports.pending, (state) => {
        state.isFetching = true;
        state.error = null;
      })
      .addCase(fetchReports.fulfilled, (state, action: PayloadAction<BugReport[]>) => {
        state.items = action.payload;
        state.loaded = true;
        state.isFetching = false;
      })
      .addCase(fetchReports.rejected, (state, action) => {
        state.isFetching = false;
        state.error = action.error.message ?? "Could not load your reports.";
      })
      .addCase(submitReport.pending, (state) => {
        state.isSubmitting = true;
      })
      .addCase(submitReport.fulfilled, (state, action) => {
        state.items.unshift(action.payload.report);
        state.isSubmitting = false;
      })
      .addCase(submitReport.rejected, (state) => {
        state.isSubmitting = false;
      });
  },
});

export const { selectReport } = supportSlice.actions;
```

- [ ] **Step 4: Register the reducer**

In `src/store/store.ts`, add the import beside the other feature slices and `support: supportSlice.reducer` to the `reducer` map:

```ts
import { supportSlice } from "@/app/dashboard/support/_store/supportSlice";
// …
      support: supportSlice.reducer,
```

- [ ] **Step 5: Run the tests**

Run: `npx jest src/app/dashboard/support`
Expected: PASS, 13 tests (7 slice + 6 attachment rules).

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/support/_store src/store/store.ts
git commit -m "feat(support): support slice reading reports through the API route"
```

---

### Task 12: Board grouping and page

**Files:**
- Create: `src/app/dashboard/support/_lib/groupReports.ts`
- Test: `src/app/dashboard/support/_lib/groupReports.test.ts`
- Create: `src/app/dashboard/support/page.tsx`
- Create: `src/app/dashboard/support/_components/ReportCard.tsx`
- Create: `src/app/dashboard/support/_components/ReportDetailPanel.tsx`

**Interfaces:**
- Consumes: `supportSlice`, `fetchReports`, `selectReport`; `useAppDispatch`/`useAppSelector` from `@/store/hooks`.
- Produces: `STATUS_COLUMNS`, `groupByStatus(reports)` → `Record<BugReportStatus, BugReport[]>`, `STATUS_LABELS`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/dashboard/support/_lib/groupReports.test.ts
import { groupByStatus, STATUS_COLUMNS, STATUS_LABELS } from "./groupReports";
import type { BugReport } from "@/types";

const at = (id: string, status: BugReport["status"], created_at: string) =>
  ({ id, status, created_at }) as BugReport;

describe("groupByStatus", () => {
  it("returns a key for every column, even empty ones", () => {
    const grouped = groupByStatus([]);
    expect(Object.keys(grouped).sort()).toEqual([...STATUS_COLUMNS].sort());
    expect(grouped.reported).toEqual([]);
  });

  it("files each report under its status", () => {
    const grouped = groupByStatus([
      at("a", "reported", "2026-09-01T00:00:00Z"),
      at("b", "fixed", "2026-09-02T00:00:00Z"),
    ]);
    expect(grouped.reported.map((r) => r.id)).toEqual(["a"]);
    expect(grouped.fixed.map((r) => r.id)).toEqual(["b"]);
  });

  it("sorts each column newest first", () => {
    const grouped = groupByStatus([
      at("older", "reported", "2026-09-01T00:00:00Z"),
      at("newer", "reported", "2026-09-09T00:00:00Z"),
    ]);
    expect(grouped.reported.map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("labels every column", () => {
    for (const status of STATUS_COLUMNS) {
      expect(STATUS_LABELS[status]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/app/dashboard/support/_lib/groupReports.test.ts`
Expected: FAIL — `Cannot find module './groupReports'`.

- [ ] **Step 3: Implement the grouping**

```ts
// src/app/dashboard/support/_lib/groupReports.ts
import type { BugReport, BugReportStatus } from "@/types";

/** Left-to-right board order. */
export const STATUS_COLUMNS: BugReportStatus[] = [
  "reported",
  "in_progress",
  "fixed",
  "wont_fix",
];

export const STATUS_LABELS: Record<BugReportStatus, string> = {
  reported: "Reported",
  in_progress: "In Progress",
  fixed: "Fixed",
  wont_fix: "Won't Fix",
};

export const STATUS_EMPTY_MESSAGES: Record<BugReportStatus, string> = {
  reported: "Nothing waiting to be picked up.",
  in_progress: "Nothing being worked on right now.",
  fixed: "Nothing fixed yet.",
  wont_fix: "Nothing closed.",
};

export function groupByStatus(reports: BugReport[]): Record<BugReportStatus, BugReport[]> {
  const grouped = Object.fromEntries(
    STATUS_COLUMNS.map((status) => [status, [] as BugReport[]])
  ) as Record<BugReportStatus, BugReport[]>;

  for (const report of reports) {
    (grouped[report.status] ?? grouped.reported).push(report);
  }

  for (const status of STATUS_COLUMNS) {
    grouped[status].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  return grouped;
}
```

- [ ] **Step 4: Run the test**

Run: `npx jest src/app/dashboard/support/_lib/groupReports.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Build the card and detail components**

Both are Client Components. Match the app's spacing scale and tokens — copy classes from an existing card section rather than inventing values. `ReportCard.tsx`:

```tsx
"use client";

import { Badge } from "@/components/ui/Badge";
import type { BugReport } from "@/types";

const SEVERITY_VARIANT: Record<string, "danger" | "warning" | "neutral"> = {
  critical: "danger",
  high: "warning",
  normal: "neutral",
  low: "neutral",
};

export function ReportCard({ report, onOpen }: { report: BugReport; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left p-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) hover:border-(--color-primary) transition-colors cursor-pointer"
    >
      <p className="text-sm font-semibold text-(--color-text) line-clamp-2">{report.title}</p>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <Badge variant="neutral">{report.type}</Badge>
        <Badge variant={SEVERITY_VARIANT[report.severity] ?? "neutral"}>{report.severity}</Badge>
        {report.attachments.length > 0 && (
          <span className="text-[11px] text-(--color-text-muted)">
            {report.attachments.length} screenshot{report.attachments.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <p className="text-xs text-(--color-text-muted) mt-2">
        {report.reporter_email} · {new Date(report.created_at).toLocaleDateString()}
        {report.replies && report.replies.length > 0 && ` · ${report.replies.length} reply`}
      </p>
    </button>
  );
}
```

Check `src/components/ui/Badge.tsx` for the actual variant names before using `danger`/`warning`/`neutral`; use whatever it exports.

`ReportDetailPanel.tsx` renders inside the shared `Modal`: full description, the captured context, each attachment as `<img src={/api/support/reports/${report.id}/attachments/${a.id}} />`, and the reply thread (author, body, date) with an empty state of "No updates yet — we'll post here when there's news."

- [ ] **Step 6: Build the page**

`page.tsx` is a Client Component that dispatches `fetchReports()` on mount, renders the four columns on `md:grid-cols-4` and a single filtered list below `md`, puts one primary `Button` ("Report an issue") in the header, and opens `ReportIssueModal` (Task 13). While `isFetching && !loaded`, show `<Loader2 size={16} className="animate-spin" />` next to "Loading reports…". On `error`, render the message in a bordered notice, not a toast-on-mount.

- [ ] **Step 7: Run the tests**

Run: `npx jest src/app/dashboard/support`
Expected: PASS, 17 tests.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/support
git commit -m "feat(support): bug tracker board with status columns and detail panel"
```

---

### Task 13: Report modal and sidebar entry

**Files:**
- Create: `src/app/dashboard/support/_components/ReportIssueModal.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (icon import + `NAV_ITEMS` entry)

**Interfaces:**
- Consumes: `Modal`, `Field`/`Input`/`Select`/`Textarea` from `@/components/ui/FormFields`, `Button`, `useToast`, `submitReport`, `fetchReports`, `validateAttachments`.
- Produces: `<ReportIssueModal open onClose pageUrl />`.

- [ ] **Step 1: Build the modal**

Every bullet of the Global Constraints' form rules applies. The skeleton:

```tsx
"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch } from "@/store/hooks";
import { submitReport, fetchReports } from "../_store/supportSlice";
import { validateAttachments, MAX_FILES, ALLOWED_MIME_TYPES } from "../_lib/attachmentRules";

const FORM_ID = "report-issue-form";

export function ReportIssueModal({
  open,
  onClose,
  pageUrl,
}: {
  open: boolean;
  onClose: () => void;
  pageUrl?: string;
}) {
  const dispatch = useAppDispatch();
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("bug");
  const [severity, setSeverity] = useState("normal");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Native `required` blocks submission but leaves the button looking
  // clickable — this is what actually disables it.
  const isFormValid =
    title.trim().length > 0 && description.trim().length >= 20 && !fileError && !saving;

  function onFilesPicked(picked: FileList | null) {
    const next = Array.from(picked ?? []);
    setFileError(
      validateAttachments(next.map((f) => ({ name: f.name, size: f.size, type: f.type })))
    );
    setFiles(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid) return;

    setSaving(true);
    const form = new FormData();
    form.append("title", title.trim());
    form.append("description", description.trim());
    form.append("type", type);
    form.append("severity", severity);
    if (pageUrl) form.append("pageUrl", pageUrl);
    for (const file of files) form.append("files", file);

    try {
      const result = await dispatch(submitReport(form)).unwrap();
      if (result.warning) {
        toast.warning("Report sent", result.warning);
      } else {
        toast.success("Report sent", "We'll post updates on this page.");
      }
      await dispatch(fetchReports());
      onClose();
      setTitle(""); setDescription(""); setFiles([]); setFileError(null);
    } catch (err) {
      toast.error("Could not send", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Report an issue"
      open={open}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form={FORM_ID} disabled={saving || !isFormValid}>
            {saving ? "Sending…" : "Send report"}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {/* Field + Input pairs; `required` on BOTH the Field and the control. */}
      </form>
    </Modal>
  );
}
```

Fill in the fields: Title (`<Field label="Title" required>` + `<Input required value … />`), Description (`<Textarea required rows={5}>` with helper text "At least 20 characters — what you expected, and what happened"), a `Row` of Type and Severity `<Select required>`s, and a file input with `accept={ALLOWED_MIME_TYPES.join(",")} multiple`, showing `fileError` through `<Field error={fileError}>` and a note reading "Up to 3 images, 4 MB total."

- [ ] **Step 2: Add the sidebar entry**

In `src/components/layout/Sidebar.tsx`, import `LifeBuoy` from `lucide-react` and add to `NAV_ITEMS`, after Planner and before Settings:

```ts
  {
    label: "Support",
    href: "/dashboard/support",
    Icon: LifeBuoy,
    roles: ["super_admin", "admin", "accountant"],
  },
```

All three roles — support is not gated by plan or permission.

- [ ] **Step 3: Run the feature tests**

Run: `npx jest src/app/dashboard/support`
Expected: PASS, 17 tests (unchanged — this task is UI wiring).

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/support/_components/ReportIssueModal.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(support): report issue modal and sidebar entry"
```

---

### Task 14: Admin view and resync

**Files:**
- Create: `src/app/admin/support/page.tsx`
- Create: `src/app/api/support/resync/route.ts`

**Interfaces:**
- Consumes: `verifyPlatformAdmin` from `@/lib/supabase/control`, `fetchCard`, `statusForList`, `trelloEnv`.
- Produces: POST `/api/support/resync` → `{ checked: number; updated: number }`.

- [ ] **Step 1: Write the resync route**

```ts
// src/app/api/support/resync/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient, verifyPlatformAdmin } from "@/lib/supabase/control";
import { trelloEnv, statusForList } from "@/lib/support/config";
import { fetchCard } from "@/lib/support/trello";
import type { BugReport } from "@/types";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const forbidden = await verifyPlatformAdmin(user?.email);
  if (forbidden) return forbidden;

  const control = createControlClient();
  const { data: reports, error } = await control
    .schema("control").from("bug_reports").select("*")
    .not("trello_card_id", "is", null)
    .neq("status", "wont_fix")
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<BugReport[]>();

  if (error) {
    console.error("[support/resync] list failed:", error.message);
    return NextResponse.json({ error: "Could not load reports." }, { status: 500 });
  }

  const env = trelloEnv();
  let updated = 0;

  for (const report of reports ?? []) {
    try {
      const card = await fetchCard({ env, cardId: report.trello_card_id! });
      const status = statusForList(card.idList, env.statusMap);
      const patch: Record<string, string> = { last_synced_at: new Date().toISOString() };

      if (status !== report.status) {
        patch.status = status;
        patch.updated_at = new Date().toISOString();
        updated += 1;
      }

      await control.schema("control").from("bug_reports").update(patch).eq("id", report.id);
    } catch (err) {
      // A deleted card shouldn't abort the sweep.
      console.error(`[support/resync] card ${report.trello_card_id} failed:`, err);
    }
  }

  return NextResponse.json({ checked: reports?.length ?? 0, updated });
}
```

Note the deliberate omission: resync does **not** fire notifications. A sweep that corrects twenty stale rows should not send twenty bells for updates that happened days ago.

- [ ] **Step 2: Build the admin page**

`src/app/admin/support/page.tsx` follows `src/app/admin/page.tsx`'s structure exactly — read it first and copy its auth guard and layout. It shows every report across tenants in a `DataTable`: tenant slug, title, type, severity, status, reporter, created date, and a link to `trello_card_url` (`target="_blank" rel="noreferrer"`). Reports with a null `trello_card_id` get a "Not in Trello" badge. A header `Button` runs the resync (`disabled` + "Syncing…" while in flight, toast with `checked`/`updated` on completion). Add a status `FilterBar` — copy an existing admin filter rather than writing a new pattern.

- [ ] **Step 3: Run the full support suite**

Run: `npx jest src/lib/support src/app/dashboard/support`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/support src/app/api/support/resync
git commit -m "feat(support): platform admin support inbox and Trello resync"
```

---

### Task 15: Webhook registration, env, and docs

**Files:**
- Create: `scripts/support/register-trello-webhook.mjs`
- Create: `src/app/dashboard/support/CLAUDE.md`
- Create: `src/app/dashboard/support/SKILL.md`
- Modify: `.env.local.example`
- Modify: `AGENTS.md`
- Modify: `src/app/dashboard/CLAUDE.md` (feature table)

- [ ] **Step 1: Write the registration script**

```js
// scripts/support/register-trello-webhook.mjs
//
// One-off: registers the board webhook with Trello.
// Deliberately a script, not a route — nobody should be able to re-register
// webhooks by hitting a URL.
//
//   node scripts/support/register-trello-webhook.mjs
//
// Trello sends a HEAD request to the callback URL during registration, so the
// app must already be deployed and reachable at TRELLO_WEBHOOK_CALLBACK_URL.
// localhost will not work — use a tunnel if you need to test locally.

const { TRELLO_API_KEY, TRELLO_API_TOKEN, TRELLO_BOARD_ID, TRELLO_WEBHOOK_CALLBACK_URL } =
  process.env;

for (const [name, value] of Object.entries({
  TRELLO_API_KEY, TRELLO_API_TOKEN, TRELLO_BOARD_ID, TRELLO_WEBHOOK_CALLBACK_URL,
})) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
}

const res = await fetch(
  `https://api.trello.com/1/webhooks?key=${TRELLO_API_KEY}&token=${TRELLO_API_TOKEN}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idModel: TRELLO_BOARD_ID,
      callbackURL: TRELLO_WEBHOOK_CALLBACK_URL,
      description: "Boughtopia support bug tracker",
    }),
  }
);

const body = await res.text();
if (!res.ok) {
  console.error(`Registration failed (${res.status}): ${body}`);
  process.exit(1);
}
console.error(`Webhook registered: ${body}`);
```

- [ ] **Step 2: Document the env vars**

Append to `.env.local.example`, matching its existing comment style:

```
# ─── Support / bug tracker (Trello) ──────────────────────────────────────────
# API key and token: https://trello.com/power-ups/admin → your Power-Up → API key
TRELLO_API_KEY=
TRELLO_API_TOKEN=
# The "secret" on the same page — used to verify webhook signatures.
TRELLO_API_SECRET=
TRELLO_BOARD_ID=
# The list new reports land in.
TRELLO_INTAKE_LIST_ID=
# JSON, list id → status. Unknown lists fall back to in_progress.
TRELLO_LIST_STATUS_MAP={"<listId>":"reported","<listId>":"in_progress","<listId>":"fixed","<listId>":"wont_fix"}
# Must match the registered webhook URL exactly — it is part of the signature.
TRELLO_WEBHOOK_CALLBACK_URL=https://<your-domain>/api/support/trello-webhook
```

- [ ] **Step 3: Write the feature docs**

`src/app/dashboard/support/CLAUDE.md` — file map (page, `_components`, `_store`, `_lib`), the data flow (control plane → API route → slice; webhook → control plane → tenant notifications), and shared deps (`src/lib/support/*`, `Modal`, `FormFields`, `Toast`, `Badge`, `DataTable`).

`src/app/dashboard/support/SKILL.md` — minimal file sets per change type, and these gotchas, each of which cost real time to establish:

1. Bug reports live in the **control plane**, so there is no RLS on them — every read path must filter by `tenant_id` explicitly, and an id from another tenant answers 404, never 403.
2. Trello attachment **downloads** reject `key`/`token` query params; they need the `Authorization: OAuth …` header. Every other endpoint takes query params.
3. The webhook signature covers `body + callbackURL`. Changing the deployment URL without re-registering the webhook silently breaks every delivery with a 401.
4. `actor_id` must be **null** on support notifications — `isUnread()` suppresses notifications caused by the current user, so stamping the reporter's id hides the update from the one person who wants it.
5. `trello_comment_id` is unique, and a `23505` from the reply insert means Trello redelivered — return 200, don't log an error.
6. The 4 MB attachment cap is Vercel's 4.5 MB request-body limit, not a preference. Raising it means building chunked uploads.
7. Screenshots are **only** on Trello. Deleting a card deletes the customer's evidence.

- [ ] **Step 4: Cross-reference from the root docs**

In `AGENTS.md`, add to the "New shared code" list:

```
- `src/lib/support/` — Trello adapter, webhook signature verification and
  reporter notifications for the support/bug-tracker feature (server-only,
  never imported client-side). `/api/support/trello-webhook` is a second
  unauthenticated-but-signed webhook alongside Stripe's — it verifies an
  HMAC-SHA1 of `body + callbackURL`, so the callback URL is part of the
  signed material and must match the registered webhook exactly.
```

Add the feature-folder table row:

```
| `src/app/dashboard/support/` | `/dashboard/support` | bug reports + tenant-scoped tracker board + `supportSlice` (all roles, all plans) |
```

And add the Support row to `src/app/dashboard/CLAUDE.md`'s feature table.

- [ ] **Step 5: Run the whole support suite one last time**

Run: `npx jest src/lib/support src/app/dashboard/support`
Expected: PASS — 40 tests across 8 suites.

- [ ] **Step 6: Commit**

```bash
git add scripts/support .env.local.example AGENTS.md src/app/dashboard/CLAUDE.md src/app/dashboard/support/CLAUDE.md src/app/dashboard/support/SKILL.md
git commit -m "docs(support): webhook registration script, env template and feature docs"
```

- [ ] **Step 7: Hand back to the user for manual verification**

`.husky/pre-push` runs `jest` and `next build` on push. Then the user must, in order:

1. Run `011_bug_reports.sql` in the Project A SQL editor (if not already done).
2. Set the seven Trello env vars in Vercel and redeploy.
3. Run `node scripts/support/register-trello-webhook.mjs` against the deployed URL.
4. Submit a report with a screenshot from `/dashboard/support`, confirm the card appears on the board with the image attached.
5. Move the card to the "Fixed" list, confirm the board updates and the bell fires.
6. Comment `@customer we shipped a fix` on the card, confirm the reply appears in the detail panel.

---

## Self-Review

**Spec coverage:** Every spec section maps to a task — data model and types (T1), `src/lib/support/trello.ts` split across config/cardContent/signature/trello (T2–T5), the four original API routes (T7, T8, T10, T14) plus the two attachment routes the screenshot change added (T9), the feature folder (T11–T13), the admin page (T14), the registration script and docs (T15). Notification behaviour is T10; error-handling table rows are distributed across T7, T9 and T10.

**Deviations from the spec, both deliberate and noted in Global Constraints:** the 5 MB per-file cap became 4 MB total (Vercel's body limit), and Trello labels were dropped in favour of a `[slug]` title prefix (no label map to maintain).

**Placeholder scan:** no TBDs. Three steps describe UI composition rather than showing every line — T12 Step 5–6 and T14 Step 2 — because each says explicitly which existing file to copy the pattern from, which is more reliable than transcribing classnames that may have drifted.

**Type consistency:** `BugReport.attachments` is `BugAttachment[]` everywhere; `attachFile` returns `BugAttachment`, matching what the route pushes and what the proxy route looks up by `id`. `statusForList(listId, map)` keeps that argument order in config, webhookActions and resync. `interpretAction` returns the same three-variant union the webhook route switches on.
