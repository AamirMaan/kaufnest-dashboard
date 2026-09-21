# Expense Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tenant attach one or more image receipts to an expense, stored
in a private Supabase Storage bucket and shown as a thumbnail strip in the
Add/Edit Expense modals.

**Architecture:** A new `expense-receipts` private Storage bucket (path
`{tenant_schema}/{expense_id}/{uuid}.{ext}`, tenant-scoped RLS mirroring the
existing `listing-images` bucket) backs a `receipts jsonb` column on
`expenses`. A shared `ReceiptUploader` component (used by both
`AddExpenseModal` and `EditExpenseModal`) uploads/deletes Storage objects
immediately on add/remove, but the `receipts` array itself is plain React
state that only reaches the database when the surrounding modal saves —
exactly the model `listings/_components/ImageGrid.tsx` already uses for
`image_urls`, reused here rather than inventing a new one. `AddExpenseModal`
additionally supports creating the expense row early (lazy, like
`ImageGrid`'s `onDraftCreated`) so a receipt attached before the rest of the
form is filled in still has a real `expense_id` to key its Storage path on;
closing the modal without submitting deletes that early row so a receipt
attachment never leaves a permanent, un-audited, partially-filled expense
behind.

**Tech Stack:** Next.js App Router, Supabase (Postgres + Storage + RLS),
Redux Toolkit, TypeScript, Jest (`testEnvironment: "node"`, no jsdom — no
component-level tests, matching every existing modal/uploader in this repo).

## Global Constraints

- Design source: `docs/superpowers/specs/2026-09-15-multicurrency-receipts-date-filters-design.md`,
  section "2. Expense receipts". This plan implements ONLY that section — the
  multicurrency-conversion (section 1) and Specific-period date filter
  (sections 3+4) parts of that spec are already implemented and merged (see
  `AGENTS.md`'s shared-deps list for `src/lib/fx/`/`src/components/import/`,
  and the `feat(*): wire up the Specific Period date filter` commits).
- Images only (`image/*`) — PDF receipts are explicitly out of scope per the
  spec.
- Bucket is **private** (`public = false`) — read via a short-lived
  `createSignedUrl(path, 60)`, never a permanent public URL. This is the
  deliberate difference from the public `listing-images` bucket.
- Tenant-schema path prefix is load-bearing for RLS — never hand-build a path
  without going through `buildReceiptPath`.
- Every migration touching a tenant table goes through
  `public.run_on_all_tenant_schemas` and is mirrored into
  `provision_tenant_schema()` (`005_tenant_provisioning.sql`) in the same
  commit — the "2-places rule" (`supabase/SKILL.md`).
- Follow the project's form conventions (`AGENTS.md` → "Form conventions"):
  real `<form>`, `required` on both `<Field required>` and its control,
  submit button `disabled` while saving or invalid, busy verb while a
  mutation is in flight, `useToast()` on both success and failure.
- No new tests for `ReceiptUploader.tsx`, `AddExpenseModal.tsx` or
  `EditExpenseModal.tsx` — this repo's Jest config has no jsdom
  (`testEnvironment: "node"`), the same reason `ImageGrid.tsx` has no test.
  Pure logic (`receiptPath.ts`) does get a colocated test.

---

## Task 1: Migration — `receipts` column, `expense-receipts` bucket, RLS

**Files:**
- Create: `supabase/migrations/046_expense_receipts.sql`
- Modify: `supabase/migrations/005_tenant_provisioning.sql:108-130` (the
  `expenses` `CREATE TABLE` block inside `provision_tenant_schema()`)
- Modify: `supabase/CLAUDE.md` (append a migration-046 bullet to the
  `migrations/` list, right after the existing `045_overview_aggregation_functions.sql`
  entry, before `## Related code`)
- Modify: `supabase/SKILL.md` (append a `migrations/046_expense_receipts.sql`
  row to the file-map table, right after the
  `migrations/045_currency_conversion.sql` row)

**Interfaces:**
- Produces: `expenses.receipts jsonb NOT NULL DEFAULT '[]'::jsonb` on every
  tenant schema. Shape consumed by later tasks: `{ path: string, name:
  string, mime: string, size: number, uploaded_at: string }[]`.
- Produces: Storage bucket id `expense-receipts` (private), with SELECT/
  INSERT/DELETE policies scoped to `(storage.foldername(name))[1] =
  (auth.jwt() -> 'app_metadata' ->> 'tenant_schema')`, no role restriction
  (any authenticated tenant member — matches `expenses_select`/
  `expenses_update`'s RLS, not the admin-only `expenses_delete`, since
  attaching/removing a receipt is an edit to the expense, not a delete of
  it).

There is no live database to apply this against as part of this task — like
every other migration file in this repo (`040`–`045`), it's written and
tracked here; applying it to the live tenant projects is a separate,
out-of-session step (the project's own `supabase-data`/`supabase-control` MCP
connections are read-only for DDL — see `supabase/SKILL.md`'s existing
"pending" rows for the established pattern). No automated test applies to
raw SQL in this repo; correctness here is a careful read, not a test run.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/046_expense_receipts.sql
-- ============================================================
-- Expense receipts — a private Storage bucket + the jsonb column that
-- indexes it.
--
-- An expense currently has nowhere to attach the invoice/receipt it was
-- entered from, so a tax audit can't follow the row back to its document.
-- See
-- docs/superpowers/specs/2026-09-15-multicurrency-receipts-date-filters-design.md
-- section 2 for the full design.
--
-- `receipts` is a jsonb array of `{ path, name, mime, size, uploaded_at }` —
-- a child table was considered and rejected: no join needed on the hot list
-- query, and it matches how `ebay_listing_drafts.image_urls`/listings'
-- `image_urls` already store an image set. Unlike that array, receipt
-- entries store a bare Storage PATH, not a URL — this bucket is private, so
-- there is no public URL to store; display goes through a signed URL
-- instead (`createSignedUrl`, 60s, see `expenses/_lib/receiptPath.ts`).
--
-- Bucket is PRIVATE (`public = false`) — the deliberate difference from
-- `listing-images` (022_listing_images_bucket.sql), which is public only
-- because eBay must fetch those URLs. A receipt is a financial document
-- with no such requirement.
--
-- Path convention `{tenant_schema}/{expense_id}/{uuid}.{ext}`, identical in
-- shape to `listing-images`' `{tenant_schema}/{draft_id}/{uuid}.{ext}` — the
-- tenant-schema prefix is load-bearing, the RLS policies below compare
-- `(storage.foldername(name))[1]` against the caller's JWT tenant_schema
-- claim.
--
-- Read is allowed to any authenticated member of the tenant (expenses are
-- not admin-only — `expenses_select`'s RLS has no role check either).
-- Insert/delete match the role that may EDIT an expense
-- (`expenses_update`'s RLS — any authenticated tenant member), not the
-- stricter admin/override-only `expenses_delete` — attaching or removing a
-- receipt is an edit to the expense row, not a delete of it.
--
-- Reuses `public.current_tenant_role()` (022_listing_images_bucket.sql) —
-- already schema-agnostic and already deployed. Unlike `listing-images`
-- (admin/super_admin-only write), any role at all clears the bar here, so
-- the check is `IS NOT NULL` rather than `IN (...)`: NULL means either no
-- tenant_schema claim or no matching profiles row (e.g. a since-deactivated
-- user whose JWT hasn't refreshed), and either way that's not "an
-- authenticated member of the tenant" — the same membership bar
-- `is_tenant_member()` enforces table-side for `expenses_select`, just
-- reached through the schema-agnostic wrapper storage policies must use.
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql,
-- same commit), so every NEW tenant gets the column from the start. The
-- bucket itself needs no per-tenant provisioning (buckets are global,
-- exactly like listing-images).
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.expenses
    ADD COLUMN IF NOT EXISTS receipts jsonb NOT NULL DEFAULT '[]'::jsonb;
$$);

INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "expense_receipts_tenant_read" ON storage.objects;
CREATE POLICY "expense_receipts_tenant_read" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_schema')
    AND public.current_tenant_role() IS NOT NULL
  );

DROP POLICY IF EXISTS "expense_receipts_tenant_write" ON storage.objects;
CREATE POLICY "expense_receipts_tenant_write" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_schema')
    AND public.current_tenant_role() IS NOT NULL
  );

DROP POLICY IF EXISTS "expense_receipts_tenant_delete" ON storage.objects;
CREATE POLICY "expense_receipts_tenant_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_schema')
    AND public.current_tenant_role() IS NOT NULL
  );
```

- [ ] **Step 2: Mirror the column into `provision_tenant_schema()`**

In `supabase/migrations/005_tenant_provisioning.sql`, the `expenses` table
block currently ends like this (around line 124-129):

```sql
      -- Currency conversion at import time — see 045_currency_conversion.sql.
      original_currency      text,
      original_total_amount  numeric(12,2),
      fx_rate                numeric(18,8) CHECK (fx_rate IS NULL OR fx_rate > 0),
      fx_rate_date           date
    )
  $sql$, schema_name);
```

Change it to:

```sql
      -- Currency conversion at import time — see 045_currency_conversion.sql.
      original_currency      text,
      original_total_amount  numeric(12,2),
      fx_rate                numeric(18,8) CHECK (fx_rate IS NULL OR fx_rate > 0),
      fx_rate_date           date,
      -- Image receipts — see 046_expense_receipts.sql.
      receipts                jsonb NOT NULL DEFAULT '[]'::jsonb
    )
  $sql$, schema_name);
```

- [ ] **Step 3: Update `supabase/CLAUDE.md`**

Append, right after the existing `migrations/045_overview_aggregation_functions.sql`
bullet and before the `## Related code` heading:

```markdown
- `migrations/046_expense_receipts.sql` — adds `receipts jsonb NOT NULL
  DEFAULT '[]'::jsonb` to `expenses` in every tenant schema via
  `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()`
  in the same commit. Creates the private `expense-receipts` Storage bucket
  (first PRIVATE bucket in this codebase — `listing-images`,
  `022_listing_images_bucket.sql`, is public) with tenant-path-scoped RLS
  reusing `public.current_tenant_role()` (read/insert/delete all match "any
  authenticated tenant member" — `current_tenant_role() IS NOT NULL` — the
  same bar as `expenses_select`/`expenses_update`, unlike `listing-images`'
  admin-only write). See
  `docs/superpowers/specs/2026-09-15-multicurrency-receipts-date-filters-design.md`
  section 2. Backs `src/app/dashboard/expenses/` — see its `SKILL.md` gotcha
  for the private-bucket/signed-URL/deferred-persistence details.
```

- [ ] **Step 4: Update `supabase/SKILL.md`**

Append, right after the existing `migrations/045_currency_conversion.sql`
row in the file-map table:

```markdown
| `migrations/046_expense_receipts.sql` | all `tenant_%` schemas | ⏳ **pending** — adds `receipts jsonb NOT NULL DEFAULT '[]'::jsonb` to `expenses` via `run_on_all_tenant_schemas`; also mirrored into `provision_tenant_schema()` in the same commit. Creates the private `expense-receipts` Storage bucket (first private bucket in this codebase) with tenant-path-scoped RLS reusing `public.current_tenant_role()` — read/insert/delete all open to any authenticated tenant member (`current_tenant_role() IS NOT NULL`). See `docs/superpowers/specs/2026-09-15-multicurrency-receipts-date-filters-design.md` section 2. Backs `src/app/dashboard/expenses/`. |
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/046_expense_receipts.sql supabase/migrations/005_tenant_provisioning.sql supabase/CLAUDE.md supabase/SKILL.md
git commit -m "$(cat <<'EOF'
feat(expenses): add receipts column + private Storage bucket migration

Section 2 of the multicurrency/receipts/date-filters design — expenses can
now hold image receipts. Migration only in this commit; app code follows.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `ExpenseReceipt` type

**Files:**
- Modify: `src/types/index.ts:44-66` (the `Expense` interface)

**Interfaces:**
- Produces: `export interface ExpenseReceipt { path: string; name: string;
  mime: string; size: number; uploaded_at: string }` and
  `Expense.receipts: ExpenseReceipt[]`, consumed by every later task.

- [ ] **Step 1: Add the type**

In `src/types/index.ts`, immediately before `export interface Expense {`
(line 44), add:

```ts
/** One uploaded receipt image. `path` is a bare Storage object path — the
 * `expense-receipts` bucket is private, so there is no public URL to store;
 * display goes through a signed URL instead. See
 * `src/app/dashboard/expenses/_lib/receiptPath.ts`. */
export interface ExpenseReceipt {
  path: string;
  name: string;
  mime: string;
  size: number;
  uploaded_at: string; // ISO timestamp
}

```

Then, inside `Expense`, right after the `fx_rate_date` field (line 65), add:

```ts
  receipts: ExpenseReceipt[];
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "$(cat <<'EOF'
feat(types): add ExpenseReceipt and Expense.receipts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `_lib/receiptPath.ts`

**Files:**
- Create: `src/app/dashboard/expenses/_lib/receiptPath.ts`
- Test: `src/app/dashboard/expenses/_lib/receiptPath.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports beyond the global `crypto`).
- Produces: `EXPENSE_RECEIPTS_BUCKET: string`, `buildReceiptPath(tenantSchema:
  string, expenseId: string, fileName: string): string`,
  `pathFromStoredReceipt(receipt: { path: string }, tenantSchema: string):
  string | null` — all consumed by Task 4's `ReceiptUploader.tsx`.

This mirrors `listings/_lib/storagePath.ts` closely (same shape,
deliberately — see that file for the reasoning this one reuses).

- [ ] **Step 1: Write the failing test**

```ts
// src/app/dashboard/expenses/_lib/receiptPath.test.ts
import { buildReceiptPath, pathFromStoredReceipt, EXPENSE_RECEIPTS_BUCKET } from "./receiptPath";

describe("EXPENSE_RECEIPTS_BUCKET", () => {
  it("is the private bucket id", () => {
    expect(EXPENSE_RECEIPTS_BUCKET).toBe("expense-receipts");
  });
});

describe("buildReceiptPath", () => {
  it("puts the tenant schema first — the bucket RLS policy matches on it", () => {
    const path = buildReceiptPath("tenant_kaufnest", "expense-1", "receipt.jpg");
    expect(path.startsWith("tenant_kaufnest/expense-1/")).toBe(true);
  });

  it("discards the user's filename, keeping only the extension", () => {
    const path = buildReceiptPath("tenant_kaufnest", "expense-1", "DHL invoice (2).PNG");
    expect(path).not.toContain("invoice");
    expect(path).not.toContain(" ");
    expect(path.endsWith(".png")).toBe(true);
  });

  it("defaults to .jpg when the filename has no extension", () => {
    expect(buildReceiptPath("tenant_a", "e1", "noextension").endsWith(".jpg")).toBe(true);
  });

  it("never collides for two files uploaded in the same millisecond", () => {
    const a = buildReceiptPath("tenant_a", "e1", "x.jpg");
    const b = buildReceiptPath("tenant_a", "e1", "x.jpg");
    expect(a).not.toBe(b);
  });
});

describe("pathFromStoredReceipt", () => {
  it("returns the path when it belongs to the caller's own tenant", () => {
    expect(
      pathFromStoredReceipt({ path: "tenant_kaufnest/expense-1/abc.jpg" }, "tenant_kaufnest")
    ).toBe("tenant_kaufnest/expense-1/abc.jpg");
  });

  it("returns null for a path under a different tenant's prefix", () => {
    expect(
      pathFromStoredReceipt({ path: "tenant_other/expense-1/abc.jpg" }, "tenant_kaufnest")
    ).toBeNull();
  });

  it("returns null for a path that merely contains the tenant name mid-string, not as its prefix", () => {
    expect(
      pathFromStoredReceipt({ path: "not_tenant_kaufnest/expense-1/abc.jpg" }, "tenant_kaufnest")
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest dashboard/expenses/_lib/receiptPath -v`
Expected: FAIL with "Cannot find module './receiptPath'"

- [ ] **Step 3: Write the implementation**

```ts
// src/app/dashboard/expenses/_lib/receiptPath.ts

export const EXPENSE_RECEIPTS_BUCKET = "expense-receipts";

/**
 * Object path for an expense receipt: `{tenant_schema}/{expenseId}/{uuid}.{ext}`.
 *
 * Mirrors `listings/_lib/storagePath.ts`'s `buildImagePath` — the
 * tenant-schema prefix is load-bearing (`046_expense_receipts.sql`'s RLS
 * policies compare `(storage.foldername(name))[1]` against the caller's JWT
 * tenant_schema claim), and the user's filename is discarded entirely: it
 * can contain spaces, unicode and slashes, and two files picked in the same
 * millisecond would otherwise collide.
 */
export function buildReceiptPath(
  tenantSchema: string,
  expenseId: string,
  fileName: string
): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  const ext = match ? match[1].toLowerCase() : "jpg";
  return `${tenantSchema}/${expenseId}/${crypto.randomUUID()}.${ext}`;
}

/**
 * The storage path for a stored receipt record, or `null` if it doesn't
 * belong to the caller's own tenant.
 *
 * Receipt entries store a bare path, not a URL (the bucket is private, so
 * there's no public URL to store) — but the `receipts` array is still
 * ordinary jsonb a client could in principle send a tampered value for.
 * Requiring the path to start with the caller's own tenant-schema prefix
 * before it's ever handed to a Storage delete/sign call is defence in
 * depth, mirroring `pathFromPublicUrl`'s host check in the listings sibling
 * (adapted for a bare path instead of a full URL).
 */
export function pathFromStoredReceipt(
  receipt: { path: string },
  tenantSchema: string
): string | null {
  const prefix = `${tenantSchema}/`;
  if (!receipt.path.startsWith(prefix)) return null;
  return receipt.path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest dashboard/expenses/_lib/receiptPath -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/expenses/_lib/receiptPath.ts src/app/dashboard/expenses/_lib/receiptPath.test.ts
git commit -m "$(cat <<'EOF'
feat(expenses): add receiptPath helpers for the private receipts bucket

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `ReceiptUploader.tsx`

**Files:**
- Create: `src/app/dashboard/expenses/_components/ReceiptUploader.tsx`

**Interfaces:**
- Consumes: `EXPENSE_RECEIPTS_BUCKET`, `buildReceiptPath`,
  `pathFromStoredReceipt` (Task 3); `ExpenseReceipt` (Task 2);
  `createClient` (`@/lib/supabase/client`); `useToast`
  (`@/components/ui/Toast`).
- Produces: `<ReceiptUploader receipts setReceipts expenseId
  onExpenseCreated onBusyChange? disabled? />`, consumed by Tasks 5 and 6.
  Props (exact):

```ts
interface Props {
  receipts: ExpenseReceipt[];
  setReceipts: (receipts: ExpenseReceipt[]) => void;
  /** The saved expense row's id, or null for a never-saved new expense. */
  expenseId: string | null;
  /** Creates the expense row and resolves with its id. Only called when
   * `expenseId` is null and the user picks at least one valid file — may
   * reject (e.g. required fields still incomplete), in which case nothing
   * is uploaded. */
  onExpenseCreated: () => Promise<string>;
  /** Mirrors the internal `uploading` flag so the parent's Save/Cancel
   * buttons can disable while a receipt is still in flight. */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}
```

This is the direct sibling of `listings/_components/ImageGrid.tsx` — same
lazy-creation contract (`onDraftCreated` → `onExpenseCreated`), same
immediate-Storage-mutation/deferred-DB-field model (`receipts` only reaches
the database when the caller's own Save/Add submits its full payload — this
component never writes to the `expenses` table itself), same
busy-flag-mirroring, same optimistic-remove-with-best-effort-cleanup. It
drops drag-to-reorder and the eBay-specific 24-image cap (nothing here needs
either) and adds a signed-URL thumbnail fetch (the bucket is private, unlike
`listing-images`).

- [ ] **Step 1: Write the component**

```tsx
// src/app/dashboard/expenses/_components/ReceiptUploader.tsx
"use client";

import { useEffect, useState } from "react";
import { ImageIcon, Loader2, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { EXPENSE_RECEIPTS_BUCKET, buildReceiptPath, pathFromStoredReceipt } from "../_lib/receiptPath";
import type { ExpenseReceipt } from "@/types";

const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;
const MAX_RECEIPT_MB = Math.round(MAX_RECEIPT_BYTES / (1024 * 1024));

interface Props {
  receipts: ExpenseReceipt[];
  setReceipts: (receipts: ExpenseReceipt[]) => void;
  expenseId: string | null;
  onExpenseCreated: () => Promise<string>;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

export function ReceiptUploader({
  receipts,
  setReceipts,
  expenseId,
  onExpenseCreated,
  onBusyChange,
  disabled,
}: Props) {
  const { success, error: toastError } = useToast();
  const [uploading, setUploading] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  function setUploadingState(next: boolean) {
    setUploading(next);
    onBusyChange?.(next);
  }

  // Private bucket — thumbnails need a signed URL, refetched whenever the
  // receipt list changes. Deliberately short-lived (60s, per the design
  // doc's section 2) — a thumbnail left open past that window just stops
  // rendering, it never serves a stale/wrong file.
  useEffect(() => {
    let cancelled = false;
    if (receipts.length === 0) {
      setSignedUrls({});
      return;
    }
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.storage
        .from(EXPENSE_RECEIPTS_BUCKET)
        .createSignedUrls(receipts.map((r) => r.path), 60);
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      for (const entry of data) {
        if (entry.signedUrl && entry.path) next[entry.path] = entry.signedUrl;
      }
      setSignedUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [receipts]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const picked = Array.from(files);
    const failures: string[] = [];

    // One bad file must never abort the rest of the batch.
    const valid = picked.filter((file) => {
      if (!file.type.startsWith("image/")) {
        failures.push(`${file.name}: only image files can be attached as receipts.`);
        return false;
      }
      if (file.size > MAX_RECEIPT_BYTES) {
        failures.push(`${file.name}: larger than ${MAX_RECEIPT_MB} MB.`);
        return false;
      }
      return true;
    });

    if (valid.length === 0) {
      setErrors(failures);
      if (failures.length > 0) toastError("Receipt not attached", failures[0]);
      return;
    }

    setUploadingState(true);
    setErrors([...failures]);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const tenantSchema = session?.user.app_metadata?.tenant_schema as string | undefined;
      if (!tenantSchema) {
        const msg = "Your workspace could not be identified. Sign out and back in.";
        setErrors([...failures, msg]);
        toastError("Receipt upload failed", msg);
        return;
      }

      // Lazy row creation: a receipt attached before the rest of the form is
      // submitted needs a real expense id to upload under.
      let targetId = expenseId;
      if (!targetId) {
        try {
          targetId = await onExpenseCreated();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Could not save the expense yet.";
          setErrors([...failures, msg]);
          toastError("Receipt not attached", msg);
          return;
        }
      }

      const uploaded: ExpenseReceipt[] = [];
      for (const file of valid) {
        try {
          const path = buildReceiptPath(tenantSchema, targetId, file.name);
          const { error: uploadError } = await supabase.storage
            .from(EXPENSE_RECEIPTS_BUCKET)
            .upload(path, file, { contentType: file.type });
          if (uploadError) throw uploadError;

          uploaded.push({
            path,
            name: file.name,
            mime: file.type,
            size: file.size,
            uploaded_at: new Date().toISOString(),
          });
        } catch (err) {
          failures.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`);
        }
      }

      if (uploaded.length > 0) {
        setReceipts([...receipts, ...uploaded]);
      }
      setErrors([...failures]);

      // No silent partial success — always one toast naming the outcome.
      if (failures.length === 0) {
        success(
          "Receipt attached",
          `${uploaded.length} file${uploaded.length !== 1 ? "s" : ""} uploaded. Save to keep ${uploaded.length !== 1 ? "them" : "it"}.`
        );
      } else if (uploaded.length > 0) {
        toastError(
          "Some receipts failed",
          `${uploaded.length} uploaded, ${failures.length} failed to upload — see the list below.`
        );
      } else {
        toastError("Receipt upload failed", failures[0]);
      }
    } finally {
      setUploadingState(false);
    }
  }

  async function removeReceipt(receipt: ExpenseReceipt) {
    // Optimistic — the tile is gone immediately; a failed Storage cleanup
    // must never block the user (same rule ImageGrid follows).
    setReceipts(receipts.filter((r) => r.path !== receipt.path));

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const tenantSchema = session?.user.app_metadata?.tenant_schema as string | undefined;
    const path = tenantSchema ? pathFromStoredReceipt(receipt, tenantSchema) : null;
    if (!path) return;

    setCleaningUp((n) => n + 1);
    try {
      const { error } = await supabase.storage.from(EXPENSE_RECEIPTS_BUCKET).remove([path]);
      if (error) console.warn("Failed to delete expense receipt", path, error);
    } finally {
      setCleaningUp((n) => n - 1);
    }
  }

  return (
    <div className="space-y-3">
      <label
        className={`flex flex-col items-center justify-center gap-1.5 rounded-(--radius-card) border-2 border-dashed border-(--color-border) p-5 text-center transition-colors ${
          uploading || disabled
            ? "opacity-60 cursor-not-allowed"
            : "cursor-pointer hover:border-(--color-primary)"
        }`}
      >
        {uploading ? (
          <Loader2 size={18} className="animate-spin text-(--color-text-faint)" />
        ) : (
          <Upload size={18} className="text-(--color-text-faint)" />
        )}
        <span className="text-sm text-(--color-text-muted)">
          {uploading ? "Uploading…" : "Click to attach a receipt"}
        </span>
        <span className="text-xs text-(--color-text-faint)">
          Images only · up to {MAX_RECEIPT_MB} MB each
        </span>
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          disabled={uploading || disabled}
          onChange={(e) => {
            handleFiles(e.target.files);
            // Let the same file be re-picked after a failure.
            e.target.value = "";
          }}
        />
      </label>

      {errors.length > 0 && (
        <ul className="space-y-1 text-sm text-(--color-danger-text)">
          {errors.map((message, i) => (
            <li key={`${i}-${message}`}>{message}</li>
          ))}
        </ul>
      )}

      {cleaningUp > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-(--color-text-faint)">
          <Loader2 size={12} className="animate-spin" />
          Removing receipt…
        </p>
      )}

      {receipts.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {receipts.map((receipt) => (
            <div
              key={receipt.path}
              className="relative rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-1"
            >
              {signedUrls[receipt.path] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={signedUrls[receipt.path]}
                  alt={receipt.name}
                  className="aspect-square w-full rounded object-cover"
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded bg-(--color-surface-subtle)">
                  <ImageIcon size={18} className="text-(--color-text-faint)" />
                </div>
              )}
              <button
                type="button"
                onClick={() => removeReceipt(receipt)}
                disabled={uploading}
                aria-label={`Remove receipt ${receipt.name}`}
                className="absolute -top-1.5 -right-1.5 rounded-full bg-(--color-danger-text) text-white p-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/expenses/_components/ReceiptUploader.tsx
git commit -m "$(cat <<'EOF'
feat(expenses): add ReceiptUploader component

Shared by AddExpenseModal and EditExpenseModal (next commits) — thumbnail
strip, add, remove, per-file progress, signed-URL previews against the
private expense-receipts bucket.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire `ReceiptUploader` into `AddExpenseModal`

**Files:**
- Modify: `src/app/dashboard/expenses/_components/AddExpenseModal.tsx`
  (full file — every function changes)

**Interfaces:**
- Consumes: `ReceiptUploader` (Task 4), `ExpenseReceipt` (Task 2).
- Produces: no new exports — this is a leaf consumer.

**Behavior added:**
1. `FormState` gains `receipts: ExpenseReceipt[]` (default `[]`).
2. A new `<Field label="Receipts">` renders `ReceiptUploader` between the
   VAT block and the Description field.
3. **Lazy row creation** (`handleExpenseCreated`, wired to
   `ReceiptUploader`'s `onExpenseCreated`): if the user attaches a receipt
   before submitting, the expense row is inserted right then, using
   whatever the form currently holds, so the receipt has a real
   `expense_id` to key its Storage path on. Rejects (no row created, nothing
   uploaded) if title/amount aren't valid yet — the same two guards
   `handleSubmit` already runs.
4. `handleSubmit` now branches: **update** the already-created row if one
   exists (`createdIdRef.current`), else **insert** as before. Either way,
   exactly one `dispatch(addExpense(...))` and one `"create"` audit log
   entry happen — the early row creation itself writes neither, so the
   compliance trail always reads as a single "expense created" event
   regardless of whether a receipt triggered an early insert.
5. **Orphan rule**: `handleClose` (Cancel, backdrop click, Escape) deletes
   the early-created row if one exists and the user never actually
   submitted — an expense row has no "draft" status the way a listing does,
   so an abandoned partial row must not survive as a real, permanently
   incomplete, un-audited expense. Its uploaded receipt Storage objects
   become orphaned files with nothing pointing at them — an accepted,
   pre-existing tradeoff (see `ImageGrid.tsx`'s own removal comment), not a
   ledger-integrity problem.
6. Both modal buttons are `disabled={saving || receiptsBusy}`.

- [ ] **Step 1: Rewrite the file**

```tsx
"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Checkbox, Row } from "@/components/ui/FormFields";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addExpense } from "../_store/expensesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { vatAmountFromGross } from "@/lib/utils/currency";
import { ReceiptUploader } from "./ReceiptUploader";
import type { ExpenseCategory, Currency, Expense, ExpenseReceipt } from "@/types";

const CATEGORIES: ExpenseCategory[] = [
  "shipping", "advertising", "software", "office",
  "inventory", "tax", "salary", "other",
];
const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: (title: string) => void;
}

interface FormState {
  title: string;
  amount: string;
  currency: Currency;
  category: ExpenseCategory;
  vendor: string;
  date: string;
  description: string;
  vat_included: boolean;
  vat_rate: string;
  vendor_vat_number: string;
  invoice_number: string;
  receipts: ExpenseReceipt[];
}

const today = () => new Date().toISOString().slice(0, 10);

function makeDefaults(defaultVatRate: number): FormState {
  return {
    title: "",
    amount: "",
    currency: "EUR",
    category: "other",
    vendor: "",
    date: today(),
    description: "",
    vat_included: false,
    vat_rate: String(defaultVatRate),
    vendor_vat_number: "",
    invoice_number: "",
    receipts: [],
  };
}

export function AddExpenseModal({ open, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const defaultVatRate = useAppSelector((s) => s.companyProfile.profile?.vat_rate ?? 19);
  const [form, setForm] = useState<FormState>(() => makeDefaults(defaultVatRate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptsBusy, setReceiptsBusy] = useState(false);

  // Set the moment a receipt-triggered early insert succeeds (see
  // `handleExpenseCreated`); read synchronously by `handleSubmit`/
  // `handleClose` so a save/cancel that races the insert never misses it.
  // `createdExpenseId` (state) mirrors it purely so it can be passed down as
  // `ReceiptUploader`'s `expenseId` prop and trigger a re-render.
  const createdIdRef = useRef<string | null>(null);
  const [createdExpenseId, setCreatedExpenseId] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // An expense amount may be NEGATIVE (a credit note) or ZERO — only a
  // NON-NUMERIC entry is invalid. The importer creates negative expenses from
  // a German VAT ledger's credit-note lines (migration 032 dropped
  // `expenses_amount_check`), and it would be incoherent for the app to import
  // a shape it refuses to let a user type by hand. Do not reintroduce an
  // `amount > 0` guard here or in `EditExpenseModal`.
  const parsedAmount = parseFloat(form.amount);
  const amountIsValid = Number.isFinite(parsedAmount);
  const amount = amountIsValid ? parsedAmount : 0;
  const vatRate = parseFloat(form.vat_rate) || 0;
  // `vatAmountFromGross` is linear in `gross`, so a negative gross yields
  // negative input tax — the correct sign for a credit note.
  const vatAmount = form.vat_included ? vatAmountFromGross(amount, vatRate) : 0;

  function buildRow() {
    return {
      title: form.title.trim(),
      amount,
      currency: form.currency,
      category: form.category,
      vendor: form.vendor.trim() || null,
      date: form.date,
      description: form.description.trim() || null,
      vat_rate: form.vat_included ? vatRate : null,
      vat_amount: form.vat_included ? vatAmount : null,
      vendor_vat_number: form.vendor_vat_number.trim() || null,
      invoice_number: form.invoice_number.trim() || null,
      receipts: form.receipts,
    };
  }

  // Wired to ReceiptUploader as `onExpenseCreated`: only called when the
  // user attaches a receipt before clicking "Add Expense" — the row needs a
  // real id for the receipt's Storage path (`_lib/receiptPath.ts`). Uses
  // whatever the form holds right now, under the same two guards
  // `handleSubmit` runs. `handleSubmit` later UPDATEs this same row instead
  // of inserting a second one; `handleClose` deletes it if the user never
  // actually submits — see that function's comment.
  async function handleExpenseCreated(): Promise<string> {
    if (createdIdRef.current) return createdIdRef.current;
    if (!form.title.trim()) throw new Error("Enter a title before attaching a receipt.");
    if (!amountIsValid) throw new Error("Enter a valid amount before attaching a receipt.");

    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error: dbError } = await supabase
      .from("expenses")
      .insert({ ...buildRow(), created_by: user!.id })
      .select()
      .single<Expense>();
    if (dbError) throw new Error(dbError.message);

    createdIdRef.current = data.id;
    setCreatedExpenseId(data.id);
    return data.id;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return setError("Title is required.");
    if (!amountIsValid) return setError("Amount must be a number.");
    setError(null);
    setSaving(true);

    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error: dbError } = createdIdRef.current
      ? await supabase
          .from("expenses")
          .update(buildRow())
          .eq("id", createdIdRef.current)
          .select()
          .single<Expense>()
      : await supabase
          .from("expenses")
          .insert({ ...buildRow(), created_by: user!.id })
          .select()
          .single<Expense>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(addExpense(data));

    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "create",
      entityType: "expense",
      entityId: data.id,
      metadata: { title: data.title, category: data.category, amount: data.amount },
    });
    if (log) dispatch(addAuditLog(log));

    createdIdRef.current = null;
    setCreatedExpenseId(null);
    setForm(makeDefaults(defaultVatRate));
    setSaving(false);
    onSuccess?.(data.title);
    onClose();
  }

  async function handleClose() {
    // Orphan rule: a receipt attached before the rest of the form was
    // submitted creates the row early (see `handleExpenseCreated`). Closing
    // without submitting must not leave that partial row behind as a real,
    // permanently incomplete, un-audited expense — delete it. Its uploaded
    // receipt objects become orphaned Storage files with nothing pointing
    // at them; that's an accepted, pre-existing tradeoff (see
    // `ImageGrid.tsx`'s own removal comment), not a ledger-integrity
    // problem — nothing in the app ever reads a deleted expense's folder.
    if (createdIdRef.current) {
      const supabase = await createTenantClient();
      await supabase.from("expenses").delete().eq("id", createdIdRef.current);
      createdIdRef.current = null;
      setCreatedExpenseId(null);
    }
    setForm(makeDefaults(defaultVatRate));
    setError(null);
    onClose();
  }

  return (
    <Modal
      title="Add Expense"
      open={open}
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose} disabled={saving || receiptsBusy}>
            Cancel
          </Button>
          <Button type="submit" form="add-expense-form" disabled={saving || receiptsBusy}>
            {saving ? "Saving…" : "Add Expense"}
          </Button>
        </>
      }
    >
      <form id="add-expense-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <Field label="Title" required>
          <Input
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. Amazon Shipping Fee"
            required
          />
        </Field>

        <Row>
          <Field label="Category" required>
            <Select
              value={form.category}
              onChange={(e) => set("category", e.target.value as ExpenseCategory)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Date" required>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              required
            />
          </Field>
        </Row>

        <Row>
          <Field label="Amount" required>
            {/* No `min` — a credit note is a negative expense, and the
                browser's own constraint validation would otherwise block
                submit before `handleSubmit` ever runs. See the amount comment
                above. */}
            <Input
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="0.00"
              required
            />
          </Field>

          <Field label="Currency" required>
            <Select
              value={form.currency}
              onChange={(e) => set("currency", e.target.value as Currency)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </Row>

        <Field label="Vendor">
          <Input
            value={form.vendor}
            onChange={(e) => set("vendor", e.target.value)}
            placeholder="e.g. DHL, Google Ads…"
          />
        </Field>

        <Row>
          <Field label="Invoice Number">
            <Input
              value={form.invoice_number}
              onChange={(e) => set("invoice_number", e.target.value)}
              placeholder="e.g. RE-2024-001"
            />
          </Field>
          <Field label="Vendor VAT Number">
            <Input
              value={form.vendor_vat_number}
              onChange={(e) => set("vendor_vat_number", e.target.value)}
              placeholder="e.g. DE123456789"
            />
          </Field>
        </Row>

        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border)] p-4">
          <Checkbox
            label="Amount includes VAT"
            checked={form.vat_included}
            onChange={(e) => set("vat_included", e.target.checked)}
          />
          {form.vat_included && (
            <>
              <Field label="VAT Rate (%)">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={form.vat_rate}
                  onChange={(e) => set("vat_rate", e.target.value)}
                />
              </Field>
              {/* Gated on "is a number", not "> 0" — a credit note's breakdown
                  is exactly the one a user needs to see. */}
              {amountIsValid && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Net {form.currency} {(amount - vatAmount).toFixed(2)} · VAT {form.currency} {vatAmount.toFixed(2)} · Gross {form.currency} {amount.toFixed(2)}
                </p>
              )}
            </>
          )}
        </div>

        <Field label="Receipts">
          <ReceiptUploader
            receipts={form.receipts}
            setReceipts={(receipts) => set("receipts", receipts)}
            expenseId={createdExpenseId}
            onExpenseCreated={handleExpenseCreated}
            onBusyChange={setReceiptsBusy}
            disabled={saving}
          />
        </Field>

        <Field label="Description">
          <Textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Optional notes…"
          />
        </Field>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Run the existing expenses test suite (nothing here has its own test, but this must not break the slice/lib tests)**

Run: `npx jest dashboard/expenses`
Expected: PASS (all existing suites unaffected — this task touches no
tested module)

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/expenses/_components/AddExpenseModal.tsx
git commit -m "$(cat <<'EOF'
feat(expenses): wire ReceiptUploader into AddExpenseModal

Lazy row creation on first receipt upload (mirrors ImageGrid's
onDraftCreated), with cleanup of the early-created row on Cancel so an
abandoned receipt attachment never leaves a permanent, un-audited,
partially-filled expense behind.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire `ReceiptUploader` into `EditExpenseModal` + docs

**Files:**
- Modify: `src/app/dashboard/expenses/_components/EditExpenseModal.tsx`
  (full file)
- Modify: `src/app/dashboard/expenses/CLAUDE.md` (file map + VAT-section
  sibling bullet for receipts)
- Modify: `src/app/dashboard/expenses/SKILL.md` (minimal-file-set entry +
  gotchas)

**Interfaces:**
- Consumes: `ReceiptUploader` (Task 4), `ExpenseReceipt` (Task 2).
- Produces: no new exports.

**Behavior added:**
1. `FormState` gains `receipts: ExpenseReceipt[]`; `expenseToForm` seeds it
   from `e.receipts`; `blankForm.receipts = []`.
2. A new `<Field label="Receipts">` renders `ReceiptUploader`, wired
   directly to the real `expense.id` (no lazy creation needed — the row
   always already exists in Edit mode). `onExpenseCreated` is required by
   `ReceiptUploader`'s prop type but is never actually called here since
   `expenseId` is never null while the modal is open; it's supplied as a
   trivial `async () => expense!.id` for type correctness.
3. `handleSubmit`'s `.update(...)` payload gains `receipts: form.receipts`
   — same deferred-persistence model as `AddExpenseModal`: Storage
   mutations happen immediately inside `ReceiptUploader`, but the DB
   `receipts` column only changes when Save Changes runs.
4. The audit-log before/after diff gains a `receipts` entry on both sides.
5. Submit button is `disabled={saving || receiptsBusy}`.

- [ ] **Step 1: Rewrite the file**

```tsx
"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Checkbox, Row } from "@/components/ui/FormFields";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateExpense } from "../_store/expensesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { resolveVatAmount } from "../_lib/vatPreservation";
import { ReceiptUploader } from "./ReceiptUploader";
import type { ExpenseCategory, Currency, Expense, ExpenseReceipt } from "@/types";

const CATEGORIES: ExpenseCategory[] = [
  "shipping", "advertising", "software", "office",
  "inventory", "tax", "salary", "other",
];
const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

interface Props {
  expense: Expense | null;
  onClose: () => void;
  onSuccess?: () => void;
}

interface FormState {
  title: string;
  amount: string;
  currency: Currency;
  category: ExpenseCategory;
  vendor: string;
  date: string;
  description: string;
  vat_included: boolean;
  vat_rate: string;
  vendor_vat_number: string;
  invoice_number: string;
  reason: string;
  receipts: ExpenseReceipt[];
}

function expenseToForm(e: Expense, defaultVatRate: number): FormState {
  return {
    title: e.title,
    amount: String(e.amount),
    currency: e.currency,
    category: e.category,
    vendor: e.vendor ?? "",
    date: e.date,
    description: e.description ?? "",
    vat_included: e.vat_rate != null || e.vat_amount != null,
    vat_rate: e.vat_rate != null ? String(e.vat_rate) : String(defaultVatRate),
    vendor_vat_number: e.vendor_vat_number ?? "",
    invoice_number: e.invoice_number ?? "",
    reason: "",
    receipts: e.receipts,
  };
}

const blankForm: FormState = {
  title: "", amount: "", currency: "EUR", category: "other", vendor: "", date: "",
  description: "", vat_included: false, vat_rate: "0",
  vendor_vat_number: "", invoice_number: "", reason: "", receipts: [],
};

export function EditExpenseModal({ expense, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const defaultVatRate = useAppSelector((s) => s.companyProfile.profile?.vat_rate ?? 19);
  const [form, setForm] = useState<FormState>(() => (expense ? expenseToForm(expense, defaultVatRate) : blankForm));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptsBusy, setReceiptsBusy] = useState(false);

  // Snapshot of the form exactly as it was populated from `expense`, used to
  // decide whether the user has touched any VAT-relevant input at all — see
  // `resolveVatAmount` for why this must be the form's OWN initial values
  // and not the expense's raw fields. Re-derived during render (the React-
  // documented "adjusting state when a prop changes" pattern, not an effect)
  // whenever `expense.id` differs from the id it was last captured for, so a
  // second edit never compares against the first row's values — `page.tsx`
  // also remounts this modal per row via `key={editTarget?.id}`, but this
  // doesn't rely on that.
  const [loadedExpenseId, setLoadedExpenseId] = useState<string | null>(expense?.id ?? null);
  const [initialForm, setInitialForm] = useState<FormState>(form);
  if ((expense?.id ?? null) !== loadedExpenseId) {
    setLoadedExpenseId(expense?.id ?? null);
    setInitialForm(expense ? expenseToForm(expense, defaultVatRate) : blankForm);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // An expense amount may be NEGATIVE (a credit note — "Erstattung von
  // Verkäufergebühren", −123.81) or ZERO, and the importer creates exactly
  // those rows. `expenses_amount_check` was dropped in migration 032 for this
  // reason, so only a NON-NUMERIC entry is invalid — mirroring
  // `validateExpenseRow`'s `Number.isFinite` rule in `expenseImportFormats.ts`.
  // Do not reintroduce an `amount > 0` guard: it makes every imported credit
  // note permanently uneditable through this form.
  const parsedAmount = parseFloat(form.amount);
  const amountIsValid = Number.isFinite(parsedAmount);
  const amount = amountIsValid ? parsedAmount : 0;
  const vatRate = parseFloat(form.vat_rate) || 0;

  const vatAmount = resolveVatAmount({
    current: form,
    initial: initialForm,
    storedVatAmount: expense?.vat_amount ?? null,
    amount,
    vatRate,
  });
  // Display-only: the preview line always shows a figure, even for a stored
  // `null` (rate with no known amount) — the write below keeps the real value.
  const displayVatAmount = vatAmount ?? 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!expense) return;
    if (!form.title.trim()) return setError("Title is required.");
    if (!amountIsValid) return setError("Amount must be a number.");
    if (!form.reason.trim()) return setError("Reason for edit is required.");
    setError(null);
    setSaving(true);

    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error: dbError } = await supabase
      .from("expenses")
      .update({
        title: form.title.trim(),
        amount,
        currency: form.currency,
        category: form.category,
        vendor: form.vendor.trim() || null,
        date: form.date,
        description: form.description.trim() || null,
        vat_rate: form.vat_included ? vatRate : null,
        vat_amount: vatAmount,
        vendor_vat_number: form.vendor_vat_number.trim() || null,
        invoice_number: form.invoice_number.trim() || null,
        receipts: form.receipts,
      })
      .eq("id", expense.id)
      .select()
      .single<Expense>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(updateExpense(data));

    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "update",
      entityType: "expense",
      entityId: expense.id,
      metadata: {
        before: { title: expense.title, amount: expense.amount, category: expense.category, vendor: expense.vendor, currency: expense.currency, date: expense.date, vat_rate: expense.vat_rate, vat_amount: expense.vat_amount, vendor_vat_number: expense.vendor_vat_number, invoice_number: expense.invoice_number, receipts: expense.receipts },
        after:  { title: data.title, amount: data.amount, category: data.category, vendor: data.vendor, currency: data.currency, date: data.date, vat_rate: data.vat_rate, vat_amount: data.vat_amount, vendor_vat_number: data.vendor_vat_number, invoice_number: data.invoice_number, receipts: data.receipts },
        reason: form.reason.trim(),
      },
    });
    if (log) dispatch(addAuditLog(log));

    setSaving(false);
    onSuccess?.();
    onClose();
  }

  return (
    <Modal
      title="Edit Expense"
      open={!!expense}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="edit-expense-form" disabled={saving || receiptsBusy}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </>
      }
    >
      <form id="edit-expense-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <Field label="Title" required>
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} required />
        </Field>

        <Row>
          <Field label="Category" required>
            <Select value={form.category} onChange={(e) => set("category", e.target.value as ExpenseCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date" required>
            <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required />
          </Field>
        </Row>

        <Row>
          <Field label="Amount" required>
            {/* No `min` — a credit note is a negative expense, and the browser's
                own constraint validation would otherwise block Save before
                `handleSubmit` ever runs. See the amount comment above. */}
            <Input type="number" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} required />
          </Field>
          <Field label="Currency" required>
            <Select value={form.currency} onChange={(e) => set("currency", e.target.value as Currency)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </Row>

        {expense?.original_currency && expense.original_total_amount !== null && expense.fx_rate !== null && (
          <p className="text-xs text-[var(--color-text-faint)]">
            Originally {expense.original_currency} {expense.original_total_amount.toFixed(2)} @{" "}
            {expense.fx_rate.toFixed(5)}
            {expense.fx_rate_date ? ` (ECB ${expense.fx_rate_date})` : ""}
          </p>
        )}

        <Field label="Vendor">
          <Input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Optional" />
        </Field>

        <Row>
          <Field label="Invoice Number">
            <Input
              value={form.invoice_number}
              onChange={(e) => set("invoice_number", e.target.value)}
              placeholder="e.g. RE-2024-001"
            />
          </Field>
          <Field label="Vendor VAT Number">
            <Input
              value={form.vendor_vat_number}
              onChange={(e) => set("vendor_vat_number", e.target.value)}
              placeholder="e.g. DE123456789"
            />
          </Field>
        </Row>

        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border)] p-4">
          <Checkbox
            label="Amount includes VAT"
            checked={form.vat_included}
            onChange={(e) => set("vat_included", e.target.checked)}
          />
          {form.vat_included && (
            <>
              <Field label="VAT Rate (%)">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={form.vat_rate}
                  onChange={(e) => set("vat_rate", e.target.value)}
                />
              </Field>
              {/* Gated on "is a number", not "> 0" — a credit note's breakdown
                  is exactly the one a user needs to see. */}
              {amountIsValid && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Net {form.currency} {(amount - displayVatAmount).toFixed(2)} · VAT {form.currency} {displayVatAmount.toFixed(2)} · Gross {form.currency} {amount.toFixed(2)}
                </p>
              )}
            </>
          )}
        </div>

        <Field label="Receipts">
          <ReceiptUploader
            receipts={form.receipts}
            setReceipts={(receipts) => set("receipts", receipts)}
            expenseId={expense?.id ?? null}
            onExpenseCreated={async () => expense!.id}
            onBusyChange={setReceiptsBusy}
            disabled={saving}
          />
        </Field>

        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional notes…" />
        </Field>

        <Field label="Reason for Edit" required>
          <Textarea
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
            placeholder="Briefly explain why this record is being edited…"
            required
          />
        </Field>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Update `src/app/dashboard/expenses/CLAUDE.md`**

In the "Files in this folder" list, right after the existing
`_components/AddExpenseModal.tsx` / `EditExpenseModal.tsx` bullet, add:

```markdown
- `_components/ReceiptUploader.tsx` — thumbnail strip, add, remove,
  per-file progress for an expense's image receipts. Used by both
  `AddExpenseModal` and `EditExpenseModal`. Same model as `ImageGrid.tsx`
  (`dashboard/listings/`): Storage upload/delete happen immediately, but the
  `receipts` array itself is local form state until the surrounding modal
  saves — this component never writes to the `expenses` table. Thumbnails
  are signed URLs (`createSignedUrl`, 60s) since the `expense-receipts`
  bucket is private, unlike `listing-images`.
- `_lib/receiptPath.ts` (+ colocated `.test.ts`) — `EXPENSE_RECEIPTS_BUCKET`,
  `buildReceiptPath(tenantSchema, expenseId, fileName)`,
  `pathFromStoredReceipt(receipt, tenantSchema)`. The user-supplied filename
  is discarded in favour of a UUID, same reasoning as the listings sibling
  `storagePath.ts`.
```

And in the "VAT (additive fields on `Expense`)" section, add a trailing
paragraph:

```markdown

## Receipts

`Expense.receipts: ExpenseReceipt[]` — `{ path, name, mime, size,
uploaded_at }`, uploaded to the private `expense-receipts` Storage bucket
(migration `046_expense_receipts.sql`). `AddExpenseModal` supports
attaching a receipt before the rest of the form is filled in: the row is
created early (lazy, like `ImageGrid`'s draft creation) so the upload has a
real `expense_id`; closing the modal without submitting deletes that early
row (see the modal's own comment) so a receipt attachment never leaves a
permanent, un-audited, partially-filled expense behind. `EditExpenseModal`
has no such concern — the row already exists.
```

- [ ] **Step 3: Update `src/app/dashboard/expenses/SKILL.md`**

In the "Minimal file set for common changes" list, add:

```markdown
- **Add/change expense receipts**: `_components/ReceiptUploader.tsx` (the
  upload/thumbnail/remove UI), `_lib/receiptPath.ts` (bucket id + path
  helpers), wired into both `AddExpenseModal.tsx` and `EditExpenseModal.tsx`.
  Schema change: `supabase/migrations/046_expense_receipts.sql` (2-places
  rule — also mirror into `provision_tenant_schema()`).
```

And in the "Gotchas" section, add:

```markdown
- **Receipts persist to the database only when the modal saves — Storage
  mutates immediately.** `ReceiptUploader` uploads/deletes Storage objects
  the moment a file is picked/removed, but never writes to the `expenses`
  table itself; the `receipts` array is plain form state until
  `AddExpenseModal`/`EditExpenseModal`'s own insert/update call includes it.
  This is a direct copy of `listings/_components/ImageGrid.tsx`'s model for
  `image_urls` — don't "simplify" one without checking the other still needs
  its own reasoning (that one also decided immediate-Storage/deferred-DB was
  the right tradeoff, and accepts the same orphan-on-cancel risk this one
  does).
- **`expense-receipts` is a PRIVATE bucket — thumbnails need a signed URL,
  not `getPublicUrl`.** `ReceiptUploader` calls
  `createSignedUrls(paths, 60)` and refetches whenever the receipt list
  changes; a thumbnail left open past that 60s window just stops rendering
  (it never serves a stale or wrong file). This is the deliberate
  difference from `listing-images` (public, since eBay must fetch those
  URLs) — see the design doc's section 2 for why a receipt has no such
  requirement.
- **`AddExpenseModal` creates the expense row early if a receipt is
  attached before the rest of the form is submitted** (`handleExpenseCreated`,
  wired to `ReceiptUploader`'s `onExpenseCreated` — mirrors `ImageGrid`'s
  `onDraftCreated`). Unlike a listing draft, an expense has no "draft"
  status, so `handleClose` (Cancel/backdrop/Escape) deletes that early row
  if the user never actually submits — don't remove that cleanup, an
  abandoned receipt attachment must never leave a permanent, un-audited,
  partially-filled expense behind. Exactly one `dispatch(addExpense(...))`
  and one `"create"` audit-log entry happen regardless of whether the row
  was inserted early or at final submit — the early insert itself writes
  neither.
```

- [ ] **Step 4: Run the existing expenses test suite**

Run: `npx jest dashboard/expenses`
Expected: PASS (all existing suites unaffected)

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/expenses/_components/EditExpenseModal.tsx src/app/dashboard/expenses/CLAUDE.md src/app/dashboard/expenses/SKILL.md
git commit -m "$(cat <<'EOF'
feat(expenses): wire ReceiptUploader into EditExpenseModal, update docs

Receipts join the before/after audit diff like every other editable field.
CLAUDE.md/SKILL.md updated in the same commit per the project's docs rule.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Manual verification (not automatable — no jsdom in this repo's Jest config)

After Task 6, ask the user to exercise the feature in a real browser (per
the working agreement — this session doesn't start `next dev` or drive a
browser without the Playwright MCP connection):

1. Add Expense → attach a receipt before filling in Title/Amount → confirm
   an inline error appears and nothing uploads.
2. Fill Title/Amount, attach 2 receipts, remove one, click Add Expense →
   confirm exactly one receipt persists after reopening the row in Edit.
3. Add Expense → attach a receipt → Cancel → confirm (via Supabase
   dashboard or a fresh page load) no phantom expense row was left behind.
4. Edit an existing expense → attach a receipt → Cancel without saving →
   confirm the expense's stored `receipts` is unchanged (the uploaded file
   may be orphaned in Storage — expected).
5. Edit an existing expense → attach and Save → reopen → confirm the
   thumbnail still renders (signed URL refetch on mount).
