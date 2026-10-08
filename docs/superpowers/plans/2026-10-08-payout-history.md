# Payout History Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/dashboard/payouts` page listing recorded eBay/Amazon payouts (paginated, filterable) with Record and Delete actions.

**Architecture:** New feature folder `src/app/dashboard/payouts/` with a paginated Redux slice (`fetchPayoutsPage`, modelled on `inventory/_store/transfersSlice.ts`), pure filter helpers in `_lib/`, and a page composed from shared `FilterBar`/`DataTable`/`Pagination`/`DeleteConfirmModal`. `RecordTransferModal` (in `dashboard/_components/`) is generalised so Home and Payouts share it. The unbounded `platform_payouts` hydration in `dashboard/layout.tsx` and the unused `platformPayoutsSlice` are removed.

**Tech Stack:** Next.js App Router (this repo's version — see `node_modules/next/dist/docs/`), Redux Toolkit, Supabase JS (`createTenantClient`), Jest, Tailwind tokens, `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-10-08-payout-history-design.md`

## Global Constraints

- Branch `feat/payout-history`; never commit to `main`.
- No database migration. RLS (migration 055): `platform_payouts` select ≥ 1, insert ≥ 2, delete ≥ 3 on section `payouts`; no UPDATE policy.
- Page access `can("payouts", 1)`; "+ Record Transfer" `can("payouts", 2)`; row Delete `can("payouts", 3)` (`useAccess()` from `@/store/useAccess`).
- Never return/show a raw Postgres error (`dbError.message`) to the user.
- Lists a user pages through use `.select("*", { count: "exact" }).range(from, to)` — never `.limit(N)`.
- Forms: real `<form id>`, `required` on controls, submit `type="submit" form="<id>"`, `disabled={saving || !isFormValid}`, busy label "Saving…", toast on success AND failure.
- Every `DataTable` has an `emptyMessage`; every icon-only button has `aria-label`.
- Colors/radii via `var(--color-*)`/`--radius-*` tokens only.
- Do not run `tsc`/`lint` by hand — `git commit` runs them (pre-commit). If pre-commit fails on `.next/types/validator.ts` "Cannot find module", delete `.next/types` and retry (stale generated route types).
- Run focused tests with `npx jest <path>`.
- Docs (`CLAUDE.md`/`SKILL.md`) updated in the **same commit** as the code they describe.
- Commit message trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## File map

| File | Change |
| --- | --- |
| `src/lib/utils/pagedQuery.ts` (+ test) | gains `pageAfterRemoval` |
| `src/app/dashboard/inventory/_lib/transfers.ts` (+ test), `_components/TransfersTab.tsx` | drop local `pageAfterRemoval`, import shared |
| `src/app/dashboard/payouts/_lib/payoutFilters.ts` (+ test) | new — `PayoutFilters`, defaults, params mapper |
| `src/app/dashboard/payouts/_store/payoutsSlice.ts` (+ test) | new — `fetchPayoutsPage` |
| `src/store/store.ts`, `src/store/StoreProvider.tsx`, `src/app/dashboard/layout.tsx` | register `payouts`; remove old payouts hydration |
| `src/store/slices/platformPayoutsSlice.ts` | deleted |
| `src/types/index.ts` | `AuditEntity` gains `"payout"` |
| `src/app/dashboard/_lib/recordTransfer.ts` (+ test) | new — pure form validity + insert payload |
| `src/app/dashboard/_components/RecordTransferModal.tsx`, `src/app/dashboard/page.tsx` | generalised modal |
| `src/app/dashboard/payouts/page.tsx` | new page |
| `src/lib/permissions/sections.ts` (+ test), `src/components/layout/Sidebar.tsx` | route + nav item |
| Docs | `payouts/CLAUDE.md`, `payouts/SKILL.md` (new); `dashboard/CLAUDE.md`, `inventory/CLAUDE.md`, `inventory/SKILL.md`, `lib/utils/SKILL.md`, `AGENTS.md` |

---

### Task 1: Promote `pageAfterRemoval` to `lib/utils/pagedQuery`

**Files:**
- Modify: `src/lib/utils/pagedQuery.ts`, `src/lib/utils/pagedQuery.test.ts`
- Modify: `src/app/dashboard/inventory/_lib/transfers.ts:160-163` (remove function), `src/app/dashboard/inventory/_lib/transfers.test.ts` (remove its `describe` + import), `src/app/dashboard/inventory/_components/TransfersTab.tsx:17`
- Docs: `src/lib/utils/SKILL.md`, `src/app/dashboard/inventory/CLAUDE.md` (lines ~217, ~317), `src/app/dashboard/inventory/SKILL.md` (~116)

**Interfaces:**
- Produces: `pageAfterRemoval(page: number, pageSize: number, totalBefore: number): number` exported from `@/lib/utils/pagedQuery`.

- [ ] **Step 1: Add the failing test** — append to `src/lib/utils/pagedQuery.test.ts` and change its import line to `import { rangeFor, DEFAULT_PAGE_SIZE, pageAfterRemoval } from "./pagedQuery";`:

```ts
describe("pageAfterRemoval", () => {
  it("stays on the page when rows remain", () => {
    expect(pageAfterRemoval(2, 50, 75)).toBe(2);
  });
  it("steps back when the last row of the last page goes", () => {
    expect(pageAfterRemoval(2, 50, 51)).toBe(1);
  });
  it("never goes below page 1", () => {
    expect(pageAfterRemoval(1, 50, 1)).toBe(1);
  });
});
```

- [ ] **Step 2: Run** `npx jest src/lib/utils/pagedQuery` — expect FAIL (`pageAfterRemoval` is not a function / not exported).

- [ ] **Step 3: Implement** — append to `src/lib/utils/pagedQuery.ts`:

```ts
/**
 * The page to reload after deleting one row from `page`, given the total
 * BEFORE the delete — steps back when the deleted row was the only one on the
 * last page. Shared by Inventory's Transfers tab and the Payouts page.
 */
export function pageAfterRemoval(page: number, pageSize: number, totalBefore: number): number {
  const lastPage = Math.ceil(Math.max(0, totalBefore - 1) / pageSize);
  return Math.max(1, Math.min(page, lastPage));
}
```

- [ ] **Step 4: Remove the inventory copy** — delete `pageAfterRemoval` (and its doc comment) from `inventory/_lib/transfers.ts`; delete the `describe("pageAfterRemoval", …)` block and the `pageAfterRemoval,` import entry from `inventory/_lib/transfers.test.ts`; in `TransfersTab.tsx` replace `import { pageAfterRemoval } from "../_lib/transfers";` with `import { pageAfterRemoval } from "@/lib/utils/pagedQuery";`.

- [ ] **Step 5: Run** `npx jest src/lib/utils/pagedQuery dashboard/inventory` — expect PASS.

- [ ] **Step 6: Docs** — in `lib/utils/SKILL.md` next to the `DEFAULT_PAGE_SIZE` bullet add: "- `pageAfterRemoval(page, pageSize, totalBefore)` — page to refetch after deleting one row (steps back off an emptied last page). Used by Inventory Transfers and Payouts." In `inventory/CLAUDE.md`/`SKILL.md`, change references from `_lib/transfers.ts`'s `pageAfterRemoval` to `@/lib/utils/pagedQuery`'s.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils/pagedQuery.ts src/lib/utils/pagedQuery.test.ts src/lib/utils/SKILL.md src/app/dashboard/inventory
git commit -m "refactor: share pageAfterRemoval via lib/utils/pagedQuery

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Payout filters (pure)

**Files:**
- Create: `src/app/dashboard/payouts/_lib/payoutFilters.ts`
- Test: `src/app/dashboard/payouts/_lib/payoutFilters.test.ts`

**Interfaces:**
- Consumes: `resolveDateBounds(f: { preset, dateFrom, dateTo }) → { from: string | null; to: string | null }` and `DatePreset` from `@/lib/utils/filters`.
- Produces:
  ```ts
  export type PayoutPlatformFilter = "all" | "ebay" | "amazon";
  export interface PayoutFilters { preset: DatePreset; dateFrom: string; dateTo: string; platform: PayoutPlatformFilter; currency: string }
  export const DEFAULT_PAYOUT_FILTERS: PayoutFilters;
  export interface PayoutFilterParams { from: string | null; to: string | null; platform: "ebay" | "amazon" | null; currency: string | null }
  export function payoutFilterParams(f: PayoutFilters): PayoutFilterParams;
  export function isDefaultPayoutFilters(f: PayoutFilters): boolean;
  ```

- [ ] **Step 1: Write the failing test** — `payoutFilters.test.ts`:

```ts
import { resolveDateBounds } from "@/lib/utils/filters";
import { DEFAULT_PAYOUT_FILTERS, isDefaultPayoutFilters, payoutFilterParams } from "./payoutFilters";

describe("payoutFilterParams", () => {
  it("maps the defaults to all-null params", () => {
    expect(payoutFilterParams(DEFAULT_PAYOUT_FILTERS)).toEqual({ from: null, to: null, platform: null, currency: null });
  });

  it("passes a specific platform and currency through", () => {
    const p = payoutFilterParams({ ...DEFAULT_PAYOUT_FILTERS, platform: "amazon", currency: "GBP" });
    expect(p.platform).toBe("amazon");
    expect(p.currency).toBe("GBP");
  });

  it("uses a custom range's bounds", () => {
    const f = { ...DEFAULT_PAYOUT_FILTERS, preset: "custom" as const, dateFrom: "2026-01-01", dateTo: "2026-03-31" };
    const p = payoutFilterParams(f);
    expect(p.from).toBe("2026-01-01");
    expect(p.to).toBe("2026-03-31");
  });

  it("resolves a preset the same way the other list pages do", () => {
    const f = { ...DEFAULT_PAYOUT_FILTERS, preset: "this_year" as const };
    const { from, to } = resolveDateBounds(f);
    expect(payoutFilterParams(f)).toMatchObject({ from, to });
    expect(from).not.toBeNull();
  });
});

describe("isDefaultPayoutFilters", () => {
  it("is true for the defaults", () => {
    expect(isDefaultPayoutFilters(DEFAULT_PAYOUT_FILTERS)).toBe(true);
  });
  it("is false once any filter is set", () => {
    expect(isDefaultPayoutFilters({ ...DEFAULT_PAYOUT_FILTERS, platform: "ebay" })).toBe(false);
    expect(isDefaultPayoutFilters({ ...DEFAULT_PAYOUT_FILTERS, currency: "USD" })).toBe(false);
    expect(isDefaultPayoutFilters({ ...DEFAULT_PAYOUT_FILTERS, preset: "this_month" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx jest dashboard/payouts` — expect FAIL (cannot find module `./payoutFilters`).

- [ ] **Step 3: Implement** — `payoutFilters.ts`:

```ts
import { resolveDateBounds, type DatePreset } from "@/lib/utils/filters";

export type PayoutPlatformFilter = "all" | "ebay" | "amazon";

export interface PayoutFilters {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  platform: PayoutPlatformFilter;
  currency: string;
}

export const DEFAULT_PAYOUT_FILTERS: PayoutFilters = {
  preset: "all",
  dateFrom: "",
  dateTo: "",
  platform: "all",
  currency: "all",
};

/** Query predicates for `fetchPayoutsPage`; `"all"`/open bounds → `null` (no predicate). */
export interface PayoutFilterParams {
  from: string | null;
  to: string | null;
  platform: "ebay" | "amazon" | null;
  currency: string | null;
}

export function payoutFilterParams(f: PayoutFilters): PayoutFilterParams {
  const { from, to } = resolveDateBounds(f);
  return {
    from,
    to,
    platform: f.platform === "all" ? null : f.platform,
    currency: f.currency === "all" ? null : f.currency,
  };
}

export function isDefaultPayoutFilters(f: PayoutFilters): boolean {
  return (
    f.preset === "all" &&
    f.dateFrom === "" &&
    f.dateTo === "" &&
    f.platform === "all" &&
    f.currency === "all"
  );
}
```

- [ ] **Step 4: Run** `npx jest dashboard/payouts` — expect PASS. (If `resolveDateBounds`'s param type requires more fields, pass `{ preset: f.preset, dateFrom: f.dateFrom, dateTo: f.dateTo }` explicitly.)

- [ ] **Step 5: Commit** (docs for the new folder land in Task 5 with the page)

```bash
git add src/app/dashboard/payouts/_lib
git commit -m "feat(payouts): filter params for payout history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `payoutsSlice` + replace the unbounded layout hydration

**Files:**
- Create: `src/app/dashboard/payouts/_store/payoutsSlice.ts`, `src/app/dashboard/payouts/_store/payoutsSlice.test.ts`
- Modify: `src/store/store.ts` (lines 14, 35), `src/store/StoreProvider.tsx` (lines 21, 35, 60, 82, 103), `src/app/dashboard/layout.tsx` (lines 21, 79, 143-147, 220), `src/types/index.ts` (`AuditEntity`)
- Delete: `src/store/slices/platformPayoutsSlice.ts`
- Docs: `src/app/dashboard/CLAUDE.md` (layout bullet's collection list)

**Interfaces:**
- Consumes: `PayoutFilters`, `payoutFilterParams` (Task 2); `rangeFor`, `DEFAULT_PAGE_SIZE` from `@/lib/utils/pagedQuery`.
- Produces:
  ```ts
  export const fetchPayoutsPage: AsyncThunk<{ data: PlatformPayout[]; count: number; page: number; pageSize: number }, { page: number; pageSize: number; filters: PayoutFilters }>;
  export const payoutsSlice; // state.payouts: { items, page, pageSize, total, loaded, isFetching, error }
  export const PAYOUTS_LOAD_ERROR = "Could not load payouts.";
  ```
  `AuditEntity` includes `"payout"`. `RecordTransferModal` will no longer compile against `addPayout` — Task 4 fixes it; in THIS task, remove the `addPayout` import and the `dispatch(addPayout(data));` line from `RecordTransferModal.tsx` (and its now-unused `useAppDispatch`/`dispatch`) so the commit type-checks.

- [ ] **Step 1: Write the failing test** — `payoutsSlice.test.ts`:

```ts
import type { PlatformPayout } from "@/types";
import { fetchPayoutsPage, payoutsSlice, PAYOUTS_LOAD_ERROR } from "./payoutsSlice";

const { reducer } = payoutsSlice;

const payout = (id: string): PlatformPayout => ({
  id,
  platform: "ebay",
  amount: 120.5,
  currency: "EUR",
  date: "2026-10-01",
  notes: null,
  created_by: "u1",
  created_at: "2026-10-01T09:00:00.000Z",
});

describe("payoutsSlice", () => {
  it("starts empty and not loaded", () => {
    expect(reducer(undefined, { type: "@@INIT" })).toEqual({
      items: [], page: 1, pageSize: 50, total: 0, loaded: false, isFetching: false, error: null,
    });
  });

  it("marks a fetch in flight and clears the last error", () => {
    const failed = { ...reducer(undefined, { type: "@@INIT" }), error: "boom" };
    const s = reducer(failed, { type: fetchPayoutsPage.pending.type });
    expect(s.isFetching).toBe(true);
    expect(s.error).toBeNull();
  });

  it("stores a fetched page", () => {
    const s = reducer(undefined, {
      type: fetchPayoutsPage.fulfilled.type,
      payload: { data: [payout("p1")], count: 51, page: 2, pageSize: 50 },
    });
    expect(s).toEqual({ items: [payout("p1")], page: 2, pageSize: 50, total: 51, loaded: true, isFetching: false, error: null });
  });

  it("keeps its rows and shows a fixed message when a fetch fails", () => {
    const loaded = reducer(undefined, {
      type: fetchPayoutsPage.fulfilled.type,
      payload: { data: [payout("p1")], count: 1, page: 1, pageSize: 50 },
    });
    const s = reducer(loaded, { type: fetchPayoutsPage.rejected.type, error: { message: "relation does not exist" } });
    expect(s.items).toEqual([payout("p1")]);
    expect(s.isFetching).toBe(false);
    expect(s.loaded).toBe(true);
    expect(s.error).toBe(PAYOUTS_LOAD_ERROR);
  });
});
```

- [ ] **Step 2: Run** `npx jest dashboard/payouts/_store` — expect FAIL (module not found).

- [ ] **Step 3: Implement** — `payoutsSlice.ts`:

```ts
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { createTenantClient } from "@/lib/supabase/client";
import { DEFAULT_PAGE_SIZE, rangeFor } from "@/lib/utils/pagedQuery";
import type { PlatformPayout } from "@/types";
import { payoutFilterParams, type PayoutFilters } from "../_lib/payoutFilters";

export const PAYOUTS_LOAD_ERROR = "Could not load payouts.";

interface PayoutsState {
  items: PlatformPayout[];
  page: number;
  pageSize: number;
  total: number;
  loaded: boolean;
  isFetching: boolean;
  error: string | null;
}

const initialState: PayoutsState = {
  items: [],
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  loaded: false,
  isFetching: false,
  error: null,
};

/** Newest first. Payouts grow with the business, so always paged. */
export const fetchPayoutsPage = createAsyncThunk(
  "payouts/fetchPage",
  async ({ page, pageSize, filters }: { page: number; pageSize: number; filters: PayoutFilters }) => {
    const supabase = await createTenantClient();
    const p = payoutFilterParams(filters);
    let query = supabase
      .from("platform_payouts")
      .select("*", { count: "exact" })
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });
    if (p.from) query = query.gte("date", p.from);
    if (p.to) query = query.lte("date", p.to);
    if (p.platform) query = query.eq("platform", p.platform);
    if (p.currency) query = query.eq("currency", p.currency);
    const [from, to] = rangeFor({ page, pageSize });
    const { data, count, error } = await query.range(from, to);
    // Never forward the raw Postgres error — the page shows PAYOUTS_LOAD_ERROR.
    if (error) throw new Error(PAYOUTS_LOAD_ERROR);
    return { data: (data ?? []) as PlatformPayout[], count: count ?? 0, page, pageSize };
  },
);

export const payoutsSlice = createSlice({
  name: "payouts",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchPayoutsPage.pending, (state) => {
        state.isFetching = true;
        state.error = null;
      })
      .addCase(fetchPayoutsPage.fulfilled, (state, action) => {
        state.items = action.payload.data;
        state.total = action.payload.count;
        state.page = action.payload.page;
        state.pageSize = action.payload.pageSize;
        state.loaded = true;
        state.isFetching = false;
      })
      .addCase(fetchPayoutsPage.rejected, (state) => {
        state.isFetching = false;
        state.error = PAYOUTS_LOAD_ERROR;
      });
  },
});
```

- [ ] **Step 4: Run** `npx jest dashboard/payouts` — expect PASS.

- [ ] **Step 5: Wire the store, remove the old slice**
  - `src/store/store.ts`: replace `import { platformPayoutsSlice } from "./slices/platformPayoutsSlice";` with `import { payoutsSlice } from "@/app/dashboard/payouts/_store/payoutsSlice";` and `platformPayouts: platformPayoutsSlice.reducer,` with `payouts: payoutsSlice.reducer,`.
  - `src/store/StoreProvider.tsx`: delete the `hydratePayouts` import, the `PlatformPayout` type import (if now unused), the `platformPayouts?: PlatformPayout[];` prop, its destructure, and the `if (platformPayouts) store.dispatch(hydratePayouts(platformPayouts));` line.
  - `src/app/dashboard/layout.tsx`: delete the `platform_payouts` query from the `Promise.all` array, the matching `{ data: platformPayoutsData },` destructure entry (keep array positions aligned — remove both together), the `PlatformPayout` type import if unused, and `platformPayouts={platformPayoutsData ?? []}`.
  - `git rm src/store/slices/platformPayoutsSlice.ts`.
  - `RecordTransferModal.tsx`: remove `import { addPayout } …`, `import { useAppDispatch } …`, `const dispatch = useAppDispatch();` and `dispatch(addPayout(data));`.
  - Run `grep -rn "platformPayouts\|hydratePayouts\|addPayout" src` — expect no hits.
  - `src/types/index.ts`: append `| "payout"` to `AuditEntity`.

- [ ] **Step 6: Docs** — `src/app/dashboard/CLAUDE.md`'s `layout.tsx` bullet: remove `platform_payouts/` from the hydrated-collections list and add a sentence: "`platform_payouts` is **not** hydrated here (removed 2026-10-08 — it was an unbounded full-table read nothing consumed); the Payouts page fetches its own pages via `fetchPayoutsPage`."

- [ ] **Step 7: Run** `npx jest dashboard src/store` — expect PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src/app/dashboard/payouts/_store src/store src/app/dashboard/layout.tsx src/app/dashboard/_components/RecordTransferModal.tsx src/types/index.ts src/app/dashboard/CLAUDE.md
git commit -m "feat(payouts): paginated payouts slice; drop unbounded layout hydration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Generalise `RecordTransferModal`

**Files:**
- Create: `src/app/dashboard/_lib/recordTransfer.ts`, `src/app/dashboard/_lib/recordTransfer.test.ts`
- Modify: `src/app/dashboard/_components/RecordTransferModal.tsx`, `src/app/dashboard/page.tsx:115-123`
- Docs: `src/app/dashboard/CLAUDE.md` (`RecordTransferModal.tsx` bullet + `_lib/` list)

**Interfaces:**
- Produces:
  ```ts
  // _lib/recordTransfer.ts
  export type PayoutPlatform = "ebay" | "amazon";
  export interface TransferForm { platform: PayoutPlatform | ""; currency: Currency; amount: string; date: string; notes: string }
  export function isTransferFormValid(f: TransferForm): boolean;
  export function transferInsertPayload(f: TransferForm, userId: string): { platform: PayoutPlatform; amount: number; currency: Currency; date: string; notes: string | null; created_by: string };
  ```
  Modal props:
  ```ts
  interface Props {
    platform?: PayoutPlatform;      // omitted → platform Select shown
    currency: Currency;             // fixed when platform given; Select default otherwise
    pendingBalance?: number;        // Home only — prefill + over-transfer warning
    onClose: () => void;
    onSaved: (payout: PlatformPayout) => void;
  }
  ```

- [ ] **Step 1: Write the failing test** — `recordTransfer.test.ts`:

```ts
import { isTransferFormValid, transferInsertPayload, type TransferForm } from "./recordTransfer";

const form = (over: Partial<TransferForm> = {}): TransferForm => ({
  platform: "ebay", currency: "EUR", amount: "100.00", date: "2026-10-08", notes: "", ...over,
});

describe("isTransferFormValid", () => {
  it("accepts a complete form", () => {
    expect(isTransferFormValid(form())).toBe(true);
  });
  it("requires a platform", () => {
    expect(isTransferFormValid(form({ platform: "" }))).toBe(false);
  });
  it("requires a positive amount", () => {
    expect(isTransferFormValid(form({ amount: "" }))).toBe(false);
    expect(isTransferFormValid(form({ amount: "0" }))).toBe(false);
    expect(isTransferFormValid(form({ amount: "-5" }))).toBe(false);
    expect(isTransferFormValid(form({ amount: "abc" }))).toBe(false);
  });
  it("requires a date", () => {
    expect(isTransferFormValid(form({ date: "" }))).toBe(false);
  });
});

describe("transferInsertPayload", () => {
  it("parses the amount, trims notes and stamps the user", () => {
    expect(transferInsertPayload(form({ amount: "12.5", notes: "  ref 42 " }), "u1")).toEqual({
      platform: "ebay", amount: 12.5, currency: "EUR", date: "2026-10-08", notes: "ref 42", created_by: "u1",
    });
  });
  it("stores blank notes as null", () => {
    expect(transferInsertPayload(form({ notes: "   " }), "u1").notes).toBeNull();
  });
  it("throws on an invalid form rather than inserting garbage", () => {
    expect(() => transferInsertPayload(form({ platform: "" }), "u1")).toThrow();
  });
});
```

- [ ] **Step 2: Run** `npx jest dashboard/_lib/recordTransfer` — expect FAIL (module not found).

- [ ] **Step 3: Implement** — `recordTransfer.ts`:

```ts
import type { Currency } from "@/types";

export type PayoutPlatform = "ebay" | "amazon";

export interface TransferForm {
  platform: PayoutPlatform | "";
  currency: Currency;
  amount: string;
  date: string;
  notes: string;
}

function parsedAmount(amount: string): number {
  const n = Number(amount);
  return Number.isFinite(n) ? n : 0;
}

export function isTransferFormValid(f: TransferForm): boolean {
  return f.platform !== "" && amountIsPositive(f.amount) && f.date !== "";
}

function amountIsPositive(amount: string): boolean {
  return amount.trim() !== "" && parsedAmount(amount) > 0;
}

export function transferInsertPayload(f: TransferForm, userId: string) {
  if (!isTransferFormValid(f) || f.platform === "") throw new Error("Invalid transfer form");
  return {
    platform: f.platform,
    amount: parsedAmount(f.amount),
    currency: f.currency,
    date: f.date,
    notes: f.notes.trim() || null,
    created_by: userId,
  };
}
```

- [ ] **Step 4: Run** `npx jest dashboard/_lib/recordTransfer` — expect PASS.

- [ ] **Step 5: Rewrite the modal** — replace `RecordTransferModal.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Row } from "@/components/ui/FormFields";
import { useAppDispatch } from "@/store/hooks";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency } from "@/lib/utils/currency";
import { useToast } from "@/components/ui/Toast";
import type { Currency, PlatformPayout } from "@/types";
import { isTransferFormValid, transferInsertPayload, type PayoutPlatform, type TransferForm } from "../_lib/recordTransfer";

interface Props {
  /** Fixed platform (Home's per-platform card). Omitted → the user picks one (Payouts page). */
  platform?: PayoutPlatform;
  /** Fixed when `platform` is given; otherwise the currency Select's default. */
  currency: Currency;
  /** Home only — prefills the amount and drives the over-transfer warning. */
  pendingBalance?: number;
  onClose: () => void;
  onSaved: (payout: PlatformPayout) => void;
}

const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];
const PLATFORM_LABELS: Record<PayoutPlatform, string> = { ebay: "eBay", amazon: "Amazon" };
const today = () => new Date().toISOString().slice(0, 10);

export function RecordTransferModal({ platform, currency, pendingBalance, onClose, onSaved }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const fixed = platform !== undefined;
  const [form, setForm] = useState<TransferForm>({
    platform: platform ?? "",
    currency,
    amount: pendingBalance !== undefined && pendingBalance > 0 ? pendingBalance.toFixed(2) : "",
    date: today(),
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const isFormValid = isTransferFormValid(form);
  const amountNum = Number(form.amount) || 0;
  const overTransfer = pendingBalance !== undefined && pendingBalance > 0 && amountNum > pendingBalance;
  const set = <K extends keyof TransferForm>(key: K, value: TransferForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid) return;
    setSaving(true);
    try {
      const supabase = await createTenantClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toastError("Session expired", "Please refresh and try again.");
        return;
      }
      const { data, error: dbError } = await supabase
        .from("platform_payouts")
        .insert(transferInsertPayload(form, user.id))
        .select()
        .single<PlatformPayout>();
      if (dbError || !data) {
        toastError("Failed to record transfer", "Please try again.");
        return;
      }
      const log = await writeAuditLog(supabase, {
        userId: user.id,
        userEmail: user.email ?? "",
        action: "create",
        entityType: "payout",
        entityId: data.id,
        metadata: { after: data },
      });
      if (log) dispatch(addAuditLog(log));
      success("Transfer recorded", `${formatCurrency(data.amount, data.currency)} from ${PLATFORM_LABELS[data.platform]}.`);
      onSaved(data);
    } catch {
      toastError("Failed to record transfer", "Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={fixed ? `Record ${PLATFORM_LABELS[platform]} Transfer` : "Record Transfer"}
      open
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="record-transfer-form" disabled={saving || !isFormValid}>
            {saving ? "Saving…" : "Record Transfer"}
          </Button>
        </>
      }
    >
      <form id="record-transfer-form" onSubmit={handleSubmit} className="space-y-4">
        {fixed ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-sm text-[var(--color-text-base)]">
            <span className="font-medium">{PLATFORM_LABELS[platform]}</span>
            <span className="mx-2 text-[var(--color-text-faint)]">·</span>
            <span>{currency}</span>
            {pendingBalance !== undefined && (
              <>
                <span className="mx-2 text-[var(--color-text-faint)]">·</span>
                <span className="text-[var(--color-text-faint)]">Pending: {formatCurrency(pendingBalance, currency)}</span>
              </>
            )}
          </div>
        ) : (
          <Row>
            <Field label="Platform" required>
              <Select value={form.platform} onChange={(e) => set("platform", e.target.value as PayoutPlatform | "")} required>
                <option value="">Select platform…</option>
                <option value="ebay">eBay</option>
                <option value="amazon">Amazon</option>
              </Select>
            </Field>
            <Field label="Currency" required>
              <Select value={form.currency} onChange={(e) => set("currency", e.target.value as Currency)} required>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </Row>
        )}

        <Row>
          <Field label="Amount" required>
            <Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" required />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required />
          </Field>
        </Row>

        {overTransfer && pendingBalance !== undefined && (
          <p className="text-xs text-amber-600">
            This amount exceeds the current pending balance ({formatCurrency(pendingBalance, currency)}). The Pending
            tile will go negative — this is allowed if earlier payouts are outside the selected date range.
          </p>
        )}

        <Field label="Notes">
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional reference number or notes…" maxLength={500} />
        </Field>
      </form>
    </Modal>
  );
}
```

Note: the old inline `error` banner is replaced by `disabled={saving || !isFormValid}` (invalid forms can't submit) and toasts for server failures. `text-amber-600` is kept verbatim from the existing modal.

- [ ] **Step 6: Update Home** — in `src/app/dashboard/page.tsx` the call site already passes `platform`, `currency`, `pendingBalance`, `onClose`; change `onSaved={() => setTransferModal(null)}` only if TypeScript complains (a `() => void` is assignable to `(payout) => void`, so no change is expected). Leave it as is.

- [ ] **Step 7: Run** `npx jest dashboard/_lib` — expect PASS.

- [ ] **Step 8: Docs** — `dashboard/CLAUDE.md`: replace the `RecordTransferModal.tsx` bullet with: "`RecordTransferModal.tsx` — records a platform payout. Shared by Home (fixed `platform`/`currency` + `pendingBalance` prefill, opened from a `PlatformStatsCard`) and the Payouts page (no `platform` → platform + currency Selects). Validity/payload in `_lib/recordTransfer.ts`. Writes a `create`/`payout` audit entry; `onSaved(payout)` lets the caller refresh." Add to the `_lib/` list: "`recordTransfer.ts` (2026-10-08) — `isTransferFormValid`, `transferInsertPayload` for `RecordTransferModal`. Colocated test."

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard/_lib/recordTransfer.ts src/app/dashboard/_lib/recordTransfer.test.ts src/app/dashboard/_components/RecordTransferModal.tsx src/app/dashboard/page.tsx src/app/dashboard/CLAUDE.md
git commit -m "feat(payouts): reusable RecordTransferModal with platform picker and audit log

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Payouts page, route gating, sidebar, docs

**Files:**
- Create: `src/app/dashboard/payouts/page.tsx`, `src/app/dashboard/payouts/CLAUDE.md`, `src/app/dashboard/payouts/SKILL.md`
- Modify: `src/lib/permissions/sections.ts:35`, `src/lib/permissions/sections.test.ts:~90`, `src/components/layout/Sidebar.tsx` (imports + `NAV_ITEMS` after Purchases)
- Docs: `AGENTS.md` (feature table), `src/app/dashboard/CLAUDE.md` (feature table)

**Interfaces:**
- Consumes: `fetchPayoutsPage`, `state.payouts` (Task 3); `DEFAULT_PAYOUT_FILTERS`, `isDefaultPayoutFilters`, `PayoutFilters`, `PayoutPlatformFilter` (Task 2); `RecordTransferModal` (Task 4); `pageAfterRemoval` (Task 1); `PlatformBadge` from `@/components/ui/Badge`; `state.users.items: Profile[]` (`id`, `full_name`, `email`); `state.companyProfile.profile?.currency`.

- [ ] **Step 1: Failing route test** — in `sections.test.ts`, inside the `sectionForPath` test, add:

```ts
    expect(sectionForPath("/dashboard/payouts")).toBe("payouts");
```

- [ ] **Step 2: Run** `npx jest src/lib/permissions` — expect FAIL (`null` received).

- [ ] **Step 3: Route** — in `sections.ts` change the payouts entry's `routes: []` to `routes: ["/dashboard/payouts"]`. Run `npx jest src/lib/permissions` — expect PASS. (If another test asserts payouts has no routes, e.g. via `firstAccessiblePath`, update that expectation to the new route.)

- [ ] **Step 4: Sidebar** — add `ArrowLeftRight` to the `lucide-react` import in `Sidebar.tsx` and insert after the Purchases item:

```ts
  {
    label: "Payouts",
    href: "/dashboard/payouts",
    Icon: ArrowLeftRight,
    section: "payouts",
  },
```

- [ ] **Step 5: Page** — create `src/app/dashboard/payouts/page.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useAccess } from "@/store/useAccess";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { Pagination } from "@/components/ui/Pagination";
import { PlatformBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { RecordTransferModal } from "../_components/RecordTransferModal";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { pageAfterRemoval } from "@/lib/utils/pagedQuery";
import type { DatePreset } from "@/lib/utils/filters";
import type { PlatformPayout } from "@/types";
import { fetchPayoutsPage } from "./_store/payoutsSlice";
import {
  DEFAULT_PAYOUT_FILTERS,
  isDefaultPayoutFilters,
  type PayoutFilters,
  type PayoutPlatformFilter,
} from "./_lib/payoutFilters";

const filterInputCls =
  "rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-(--color-text-strong) focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";

export default function PayoutsPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const { items, page, pageSize, total, loaded, isFetching, error } = useAppSelector((s) => s.payouts);
  const users = useAppSelector((s) => s.users.items);
  const baseCurrency = useAppSelector((s) => s.companyProfile.profile?.currency) ?? "EUR";
  const { can } = useAccess();
  const canRecord = can("payouts", 2);
  const canDelete = can("payouts", 3);

  const [filters, setFilters] = useState<PayoutFilters>(DEFAULT_PAYOUT_FILTERS);
  const [recordOpen, setRecordOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlatformPayout | null>(null);
  const hasActive = !isDefaultPayoutFilters(filters);

  useEffect(() => {
    if (!loaded) dispatch(fetchPayoutsPage({ page: 1, pageSize, filters: DEFAULT_PAYOUT_FILTERS }));
  }, [loaded, pageSize, dispatch]);

  const userName = useMemo(() => {
    const byId = new Map(users.map((u) => [u.id, u.full_name || u.email]));
    return (id: string) => byId.get(id) ?? "—";
  }, [users]);

  function applyFilters(next: PayoutFilters) {
    setFilters(next);
    dispatch(fetchPayoutsPage({ page: 1, pageSize, filters: next }));
  }

  function setFilter<K extends keyof PayoutFilters>(key: K, value: PayoutFilters[K]) {
    applyFilters({ ...filters, [key]: value });
  }

  // Atomic — three separate setFilter calls would drop two of three fields (see FilterBar's SKILL.md).
  function setPeriod(preset: DatePreset, dateFrom: string, dateTo: string) {
    applyFilters({ ...filters, preset, dateFrom, dateTo });
  }

  function handleSaved() {
    setRecordOpen(false);
    dispatch(fetchPayoutsPage({ page: 1, pageSize, filters }));
  }

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      const supabase = await createTenantClient();
      const { data, error: deleteError } = await supabase
        .from("platform_payouts")
        .delete()
        .eq("id", target.id)
        .select("id");
      if (deleteError) {
        toastError("Delete failed", "Could not delete the transfer. Please try again.");
        return;
      }
      // RLS turns a forbidden delete into a silent 0-row no-op, not an error.
      if (!data || data.length === 0) {
        toastError("Delete failed", "You don't have permission to delete this transfer, or it no longer exists.");
        return;
      }
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const log = await writeAuditLog(supabase, {
            userId: user.id,
            userEmail: user.email ?? "",
            action: "delete",
            entityType: "payout",
            entityId: target.id,
            metadata: { before: target, reason },
          });
          if (log) dispatch(addAuditLog(log));
        }
      } catch {
        // Best-effort: the payout is already deleted.
      }
      success("Transfer deleted", `${formatCurrency(target.amount, target.currency)} on ${formatDate(target.date)} was removed.`);
      setDeleteTarget(null);
      dispatch(fetchPayoutsPage({ page: pageAfterRemoval(page, pageSize, total), pageSize, filters }));
    } catch {
      // Keep deleteTarget so the modal stays open for a retry.
      toastError("Delete failed", "Please check your connection and try again.");
    }
  }

  const columns = [
    {
      header: "Date",
      render: (p: PlatformPayout) => <span className="text-sm text-(--color-text-muted) whitespace-nowrap">{formatDate(p.date)}</span>,
    },
    { header: "Platform", render: (p: PlatformPayout) => <PlatformBadge platform={p.platform} /> },
    {
      header: "Amount",
      render: (p: PlatformPayout) => (
        <span className="text-sm font-semibold tabular-nums text-(--color-text-strong)">{formatCurrency(p.amount, p.currency)}</span>
      ),
    },
    { header: "Notes", render: (p: PlatformPayout) => <span className="text-sm text-(--color-text-muted)">{p.notes ?? "—"}</span> },
    { header: "Recorded by", render: (p: PlatformPayout) => <span className="text-sm text-(--color-text-base)">{userName(p.created_by)}</span> },
    ...(canDelete
      ? [
          {
            header: "Actions",
            render: (p: PlatformPayout) => (
              <Button
                size="icon"
                variant="danger"
                onClick={() => setDeleteTarget(p)}
                title="Delete"
                aria-label={`Delete transfer of ${formatCurrency(p.amount, p.currency)} on ${formatDate(p.date)}`}
              >
                <Trash2 size={15} />
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Payouts"
        description="Transfers recorded from eBay and Amazon to your bank"
        action={canRecord ? <Button onClick={() => setRecordOpen(true)}>+ Record Transfer</Button> : undefined}
      />

      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        onPeriodChange={setPeriod}
        currency={filters.currency}
        onCurrencyChange={(v) => setFilter("currency", v)}
        hasActive={hasActive}
        onClear={() => applyFilters(DEFAULT_PAYOUT_FILTERS)}
      >
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-(--color-text-faint) mb-1">Platform</span>
          <select
            value={filters.platform}
            onChange={(e) => setFilter("platform", e.target.value as PayoutPlatformFilter)}
            className={filterInputCls}
            aria-label="Platform"
          >
            <option value="all">All Platforms</option>
            <option value="ebay">eBay</option>
            <option value="amazon">Amazon</option>
          </select>
        </div>
      </FilterBar>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4">
          <p className="text-sm text-(--color-text-muted)">{error}</p>
          <Button variant="secondary" onClick={() => dispatch(fetchPayoutsPage({ page, pageSize, filters }))}>
            <RefreshCw size={15} aria-hidden /> Retry
          </Button>
        </div>
      )}

      <div className={isFetching ? "opacity-60 pointer-events-none transition-opacity" : ""}>
        <DataTable
          columns={columns}
          rows={items}
          keyField="id"
          emptyMessage={hasActive ? "No transfers match the current filters." : "No transfers recorded yet."}
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(p) => dispatch(fetchPayoutsPage({ page: p, pageSize, filters }))}
          onPageSizeChange={(s) => dispatch(fetchPayoutsPage({ page: 1, pageSize: s, filters }))}
        />
      </div>

      {canRecord && recordOpen && (
        <RecordTransferModal currency={baseCurrency} onClose={() => setRecordOpen(false)} onSaved={handleSaved} />
      )}
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Transfer"
        description={
          deleteTarget
            ? `This will permanently delete the ${formatCurrency(deleteTarget.amount, deleteTarget.currency)} transfer from ${deleteTarget.platform === "ebay" ? "eBay" : "Amazon"} on ${formatDate(deleteTarget.date)}. Platform balances will be recalculated.`
            : ""
        }
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
```

Notes for the implementer:
- `FilterBar`'s `earliestYear` is optional; omit it (the "Specific period" year list then defaults). Don't add a `fetchEarliestYear` query (YAGNI).
- `useAccess` lives at `src/store/useAccess.ts` — confirm the import path before writing.
- `PlatformBadge` takes `Platform` (`"amazon" | "ebay" | …`); `PlatformPayout["platform"]` is assignable.
- If `DataTable`'s column type requires `sortValue`, check `src/components/ui/DataTable.tsx` — TransfersTab omits it, so it is optional.

- [ ] **Step 6: Feature docs** — create `src/app/dashboard/payouts/CLAUDE.md`:

```markdown
# Payouts feature

Route: `/dashboard/payouts`. History of platform payouts (eBay/Amazon → bank
transfers) recorded in `platform_payouts`, with Record and Delete.

## Files

- `page.tsx` — paginated list (`fetchPayoutsPage`), `FilterBar` (date preset/
  period, currency) + a Platform `<select>` child, `DataTable` (Date, Platform,
  Amount, Notes, Recorded by, Actions), `Pagination`, error banner + Retry.
  "+ Record Transfer" opens the shared `RecordTransferModal`
  (`../_components/`) without a `platform` prop (platform + currency Selects,
  currency defaults to `companyProfile.currency`); on save refetches page 1.
  Delete → `DeleteConfirmModal` → `.delete().eq("id").select("id")` (0 rows =
  RLS refusal, toasted), audit `delete`/`payout`, refetch at
  `pageAfterRemoval` (`@/lib/utils/pagedQuery`). "Recorded by" resolves
  `created_by` against `state.users.items` (`full_name` → `email` → `—`).
- `_store/payoutsSlice.ts` (+ test) — `state.payouts`; `fetchPayoutsPage({
  page, pageSize, filters })`, newest first (`date`, then `created_at`). Throws
  the fixed `PAYOUTS_LOAD_ERROR`, never the Postgres message. Not hydrated by
  `dashboard/layout.tsx` — the page fetches page 1 on mount.
- `_lib/payoutFilters.ts` (+ test) — `PayoutFilters`, `DEFAULT_PAYOUT_FILTERS`,
  `payoutFilterParams` (`resolveDateBounds`; `"all"` → null),
  `isDefaultPayoutFilters`.

## Access (section `payouts`, RLS from migration 055)

View ≥ 1 (route gated by `proxy.ts` via `sections.ts` routes), Record ≥ 2,
Delete ≥ 3. There is no UPDATE policy, so payouts are not editable.

## Shared deps

`components/ui/{DataTable,FilterBar,Pagination,Badge(PlatformBadge),Button,Toast}`,
`components/modals/DeleteConfirmModal`, `dashboard/_components/RecordTransferModal`,
`lib/utils/{pagedQuery,filters,currency,date,audit}`, `store/useAccess`.

## Tests

`npx jest dashboard/payouts`
```

Create `src/app/dashboard/payouts/SKILL.md`:

```markdown
# Payouts — agent playbook

## Minimal file set per change

- **Add a column / change row actions:** `page.tsx` only.
- **Add a filter:** `_lib/payoutFilters.ts` (+ test) for the type, default,
  params and `isDefaultPayoutFilters`; `_store/payoutsSlice.ts` to apply the
  predicate; `page.tsx` for the control.
- **Change the record form:** `../_components/RecordTransferModal.tsx` +
  `../_lib/recordTransfer.ts` (+ test). It is shared with Home — keep the
  fixed-`platform` + `pendingBalance` path working.

## Gotchas

- `platform_payouts` used to be fully loaded by `dashboard/layout.tsx` into a
  `platformPayoutsSlice` nobody read (unbounded; truncated at PostgREST Max
  Rows). Removed 2026-10-08 — don't reintroduce layout hydration; Home and
  Analytics get payout totals from `get_payouts_overview` /
  `get_platform_running_balance`.
- A forbidden delete is not an error under RLS — it deletes 0 rows. The
  `.select("id")` after `.delete()` is what detects it.
- Home's pending-balance figures come from RPCs, so deleting/recording here
  is reflected on Home on its next load, not live.
```

- [ ] **Step 7: Index docs** — add a row to the feature table in `AGENTS.md` after Purchases:
`| \`src/app/dashboard/payouts/\` | \`/dashboard/payouts\` | recorded eBay/Amazon payout history + \`payoutsSlice\` (record ≥ 2, delete ≥ 3 on section \`payouts\`) |`
and the same row (relative path `payouts/`) to the table in `src/app/dashboard/CLAUDE.md`.

- [ ] **Step 8: Run** `npx jest dashboard/payouts dashboard/_lib src/lib/permissions src/lib/utils/pagedQuery dashboard/inventory` — expect PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard/payouts src/lib/permissions src/components/layout/Sidebar.tsx AGENTS.md src/app/dashboard/CLAUDE.md
git commit -m "feat(payouts): payout history page with record and delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Manual check** — ask the user (or use Playwright MCP if `npm run dev` is already running) to verify: sidebar shows Payouts; list loads; platform/date/currency filters work; "+ Record Transfer" disabled until platform + amount set, records and appears; delete removes the row; a level-1 user sees no Record/Delete; Home's "Record Transfer" still prefills the pending balance.
