# Order Status Pull-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Sync Statuses" button to the Review Orders page that
refreshes `status` (and the other platform-owned fields) on already-imported
orders from eBay/Amazon, closing the read-direction gap left by the
existing app→eBay status push feature.

**Architecture:** Zero new backend code. The existing
`POST /api/integrations/review/import` route already runs every submitted
order through `mergeImportedSale()`, which already classifies `status` as
platform-owned (overwritten on every import/re-import) while preserving
user-owned fields. The only gap is that `review/page.tsx`'s UI never lets an
already-imported order be re-selected and re-submitted. This plan adds a
second, independent submission path in that same page — re-fetch fresh
platform data, collect every already-imported order, POST them to the same
import route with no purchase-cost/fee payload — reusing the tested backend
path unchanged.

**Tech Stack:** Next.js App Router (Client Component), Redux Toolkit (no
slice changes needed — the refresh happens via `router.refresh()`, same as
the existing Import button), TypeScript, existing `Button`/`Toast` UI
primitives.

## Global Constraints

- Never query `public.*` in a tenant-schema route — not applicable here (no
  new route), but kept for consistency with every plan in this repo.
- No dev server, no `curl`, no `npm test`/`tsc`/`lint` run mid-task by the
  implementer — ask the human to verify in browser instead (per this repo's
  `AGENTS.md` working agreement). The pre-commit hook runs `tsc`/`eslint`/the
  project verifier automatically on every `git commit`; fix what it reports
  and re-run the same commit command.
- A mutating button must never look clickable when it can't succeed, and
  must never look idle while its request is in flight (`AGENTS.md`'s "Form
  conventions" section) — the new "Sync Statuses" button must be `disabled`
  whenever there's nothing to sync or a request (sync or import) is already
  in flight, and its label must swap to a busy verb while syncing.
- Every task ends with a `git commit`, including the doc update — this repo
  requires docs and code to land in the same commit, not as a follow-up.

---

### Task 1: Add "Sync Statuses" button + handler to Review Orders page

**Files:**
- Modify: `src/app/dashboard/integrations/review/page.tsx`
- Modify: `src/app/dashboard/integrations/CLAUDE.md`

**Interfaces:**
- Consumes: `GET /api/integrations/review` (existing, returns
  `ReviewResponse` — `Partial<Record<IntegrationPlatform, { orders:
  ReviewOrder[] }>> & { errors?: Record<string, string> }`, where
  `ReviewOrder = NormalizedOrder & { imported: boolean }`), and
  `POST /api/integrations/review/import` (existing, accepts `{ items: {
  platform: IntegrationPlatform; order: NormalizedOrder }[]; purchaseCosts?:
  ...; orderFees?: ... }`, returns `{ imported: number; createdPurchases?:
  Purchase[]; purchaseWarning?: string; error?: string; detail?: string }`).
  Neither route changes in this task.
- Produces: nothing new consumed by other files — this is a leaf UI change.

This is a single self-contained task — the change is confined to one file's
component logic plus its own doc file, with no shared interface for a
second task to depend on, so there's no benefit to splitting it further per
the writing-plans "Task Right-Sizing" rule.

- [ ] **Step 1: Read the current file to confirm it matches this plan's
  assumptions**

  Open `src/app/dashboard/integrations/review/page.tsx` and confirm it still
  contains the `handleImport` function and the "Import button" `<div
  className="flex justify-end">` block near the end of the JSX (around the
  file's last ~15 lines before the closing `</div>`). If the file has
  diverged significantly from what's described below, stop and report
  `NEEDS_CONTEXT` rather than guessing — this plan was written against the
  file's state as of 2026-09-07.

- [ ] **Step 2: Add `syncing` state**

  Find this existing state block near the top of the `ReviewPage` component:

  ```tsx
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  ```

  Add a new `syncing` state directly after `importing`:

  ```tsx
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  ```

- [ ] **Step 3: Add a `hasImportedOrders` derived value**

  Find this existing derived-value block (right after the `activeOrders`
  definition, before `unimportedOnTab`):

  ```tsx
  const activeOrders: ReviewOrder[] = activeTab
    ? (data?.[activeTab]?.orders ?? [])
    : [];

  const unimportedOnTab = activeOrders.filter((o) => !o.imported);
  ```

  Add a new derived value directly after `unimportedOnTab`, computed across
  **all** platforms (not just the active tab) — this is what the Sync
  button's `disabled` prop reads:

  ```tsx
  const hasImportedOrders = platforms.some((p) =>
    (data?.[p]?.orders ?? []).some((o) => o.imported)
  );
  ```

  (`platforms` is already defined earlier in the file as `data ?
  ALL_PLATFORMS.filter((p) => data[p]) : []` — reuse it, don't redefine it.)

- [ ] **Step 4: Add the `handleSyncStatuses` function**

  Find the existing `handleImport` function (starts with `async function
  handleImport() {`, ends with its closing `}` right before the line `const
  cardCls =`). Add a new function directly after `handleImport`'s closing
  brace, before the `cardCls` line:

  ```tsx
  async function handleSyncStatuses() {
    setImportError(null);
    setSyncing(true);

    try {
      const freshRes = await fetch("/api/integrations/review");
      const fresh = (await freshRes.json()) as ReviewResponse;

      const items: { platform: IntegrationPlatform; order: ReviewOrder }[] = [];
      for (const platform of ALL_PLATFORMS) {
        for (const order of fresh[platform]?.orders ?? []) {
          if (order.imported) items.push({ platform, order });
        }
      }

      if (items.length === 0) {
        setData(fresh);
        toast.info("Nothing to sync", "No previously-imported orders found.");
        return;
      }

      const res = await fetch("/api/integrations/review/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const result = (await res.json()) as { imported?: number; error?: string; detail?: string };

      if (!res.ok) {
        const message = result.detail ?? result.error ?? "Sync failed";
        setImportError(message);
        toast.error("Sync failed", message);
        return;
      }

      setData(fresh);
      const syncedCount = result.imported ?? 0;
      toast.success(
        "Statuses synced",
        `${syncedCount} order${syncedCount === 1 ? "" : "s"} synced from eBay/Amazon.`
      );
      router.refresh();
    } catch {
      const message = "Network error — please try again";
      setImportError(message);
      toast.error("Sync failed", message);
    } finally {
      setSyncing(false);
    }
  }
  ```

  **Note the `toast.info` call in the empty-items branch** — confirm
  `useToast()` (from `src/components/ui/Toast.tsx`) exports an `info`
  variant on the object returned by the hook (it does — see
  `src/components/ui/SKILL.md`'s Toast.tsx entry: `{ toast, success,
  warning, error, info }`). This file currently destructures `const toast =
  useToast();` (not individual named exports like `EditSaleModal.tsx` does)
  — keep that existing style, so the calls above are `toast.success(...)`/
  `toast.error(...)`/`toast.info(...)`, matching the file's current
  `toast.error("Import failed", message)` calls elsewhere in
  `handleImport`. Do **not** change the existing destructuring pattern.

- [ ] **Step 5: Add the "Sync Statuses" button to the JSX**

  Find the existing "Import button" block near the end of the returned JSX:

  ```tsx
          {/* Import button */}
          <div className="flex justify-end">
            <Button
              onClick={handleImport}
              disabled={selected.size === 0 || importing}
            >
              {importing
                ? "Importing…"
                : `Import selected (${selected.size})`}
            </Button>
          </div>
  ```

  Replace it with:

  ```tsx
          {/* Sync + Import buttons */}
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={handleSyncStatuses}
              disabled={!hasImportedOrders || syncing || importing}
            >
              {syncing ? "Syncing…" : "Sync Statuses"}
            </Button>
            <Button
              onClick={handleImport}
              disabled={selected.size === 0 || importing || syncing}
            >
              {importing
                ? "Importing…"
                : `Import selected (${selected.size})`}
            </Button>
          </div>
  ```

  (Adds `disabled={... || syncing}` to the existing Import button too, so
  the two mutating actions can never race each other against the same
  backend route.)

- [ ] **Step 6: Update `src/app/dashboard/integrations/CLAUDE.md`**

  Find this existing bullet in the "Files in this folder" section:

  ```markdown
  - `review/page.tsx` — "Review Orders" page at `/dashboard/integrations/review`.
    Fetches `GET /api/integrations/review` on mount (only when eligible), renders
    platform tabs (eBay / Amazon), an order table with checkbox selection
    (already-imported rows greyed out with ✓), and an "Import selected (N)" button
    that posts to `POST /api/integrations/review/import`. On success: toasts, flips
    imported rows in local state, calls `router.refresh()` to re-hydrate
    `salesSlice`. Applies the same plan/role guards as `page.tsx` — redirects to
    `/dashboard/integrations` if not eligible.
  ```

  Replace it with (adds one paragraph, keeps everything else — including the
  "Fee entry" paragraph that follows it in the real file — unchanged):

  ```markdown
  - `review/page.tsx` — "Review Orders" page at `/dashboard/integrations/review`.
    Fetches `GET /api/integrations/review` on mount (only when eligible), renders
    platform tabs (eBay / Amazon), an order table with checkbox selection
    (already-imported rows greyed out with ✓), and an "Import selected (N)" button
    that posts to `POST /api/integrations/review/import`. On success: toasts, flips
    imported rows in local state, calls `router.refresh()` to re-hydrate
    `salesSlice`. Applies the same plan/role guards as `page.tsx` — redirects to
    `/dashboard/integrations` if not eligible.
    **"Sync Statuses" button (2026-09-07)**: a second, independent submission
    path to the *same* import route — re-fetches `GET /api/integrations/review`
    for fresh platform data, collects every order already marked `imported:
    true` across **both** platform tabs (not just the active one), and POSTs
    them to `POST /api/integrations/review/import` with no
    `purchaseCosts`/`orderFees` keys. This reaches orders the checkbox-based
    Import flow can never re-select (already-imported rows render a static "✓"
    instead of a checkbox), and relies entirely on `mergeImportedSale.ts`'s
    existing platform-owned/user-owned field split — no new backend code. See
    `docs/superpowers/specs/2026-09-07-order-status-pull-sync-design.md` for
    the full design.
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add src/app/dashboard/integrations/review/page.tsx src/app/dashboard/integrations/CLAUDE.md
  git commit -m "feat(integrations): sync already-imported order statuses from eBay/Amazon

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

## Manual verification (ask the human to run — no dev server/curl by the implementer)

1. Connect an eBay sandbox account, import at least one order via the
   existing Import flow.
2. Change that order's status on the eBay sandbox seller side (outside the
   app) — e.g. mark it shipped or cancelled directly on eBay.
3. Return to `/dashboard/integrations/review`, confirm the row still shows
   as imported (✓, greyed out) but its Status badge already reflects the new
   eBay status (that badge has always been live-fetched — this step just
   confirms nothing regressed).
4. Click "Sync Statuses" — confirm the button shows "Syncing…" while in
   flight, then a success toast naming the synced count.
5. Go to `/dashboard/sales`, find that order — confirm its status column now
   matches eBay's current status (this is the actual fix; before this
   change it would still show the status from initial import).
6. Before step 4, manually edit that same order in the Sales page to set a
   VAT rate or link an inventory product — confirm both survive the sync
   unchanged (proves `mergeImportedSale`'s user-owned fields are untouched).
7. With zero imported orders in view (e.g. a fresh eBay sandbox with nothing
   imported yet), confirm the "Sync Statuses" button renders disabled.

## Self-Review Notes (completed during plan authoring)

- **Spec coverage**: every section of `2026-09-07-order-status-pull-sync-design.md`
  maps to a step above — button placement/enablement (Steps 3, 5), the
  re-fetch-then-submit handler (Step 4), the empty-items early return (Step 4),
  omitting `purchaseCosts`/`orderFees` (Step 4), the docs update (Step 6),
  and the spec's manual-verification checklist is reproduced as this plan's
  own verification section.
- **Placeholder scan**: no "TBD"/"handle it"/"similar to Task N" language —
  every step has literal, complete code to paste in.
- **Type consistency**: `handleSyncStatuses` uses `ReviewResponse`/
  `ReviewOrder`/`IntegrationPlatform` — all three are already imported in
  the file's existing `import type { ReviewOrder, ReviewResponse } from
  "@/app/api/integrations/review/route";` and `import type { Currency,
  IntegrationPlatform, Purchase } from "@/types";` lines, so no new imports
  are needed. The `items` array's element type (`{ platform:
  IntegrationPlatform; order: ReviewOrder }`) matches what `handleImport`
  already builds and what the import route already accepts (`order:
  NormalizedOrder` — `ReviewOrder` extends `NormalizedOrder`, so passing a
  `ReviewOrder` where `NormalizedOrder` is expected is structurally valid;
  the route only reads `NormalizedOrder`'s fields).
