# CSV Import Date Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the CSV importer silently guessing whether `10-04-2026` is 10 April or 4 October — detect the order from evidence in the file, let the user override it, and refuse a file that contains evidence for both.

**Architecture:** A pure `detectDateOrder()` scans every date cell before any row is validated: a first field over 12 proves day-first, a second field over 12 proves month-first. `parseFlexibleDate` gains an optional `order` parameter defaulting to `"dmy"`, so every existing call site and test is unchanged. The modal runs detection once per file, shows what it found, and offers an override.

**Tech Stack:** TypeScript, Jest, Next.js App Router, React.

**Source spec:** `docs/superpowers/specs/2026-08-04-import-date-order-design.md`

## Global Constraints

- **`parseFlexibleDate`'s `order` parameter MUST default to `"dmy"`.** It is shared by all three import formats; a different default silently changes generic and eBay imports.
- **Dot-separated dates (`15.01.2024`) are ALWAYS day-first**, regardless of the `order` argument. `DD.MM.YYYY` is the German convention and `MM.DD.YYYY` does not occur.
- **Evidence beats override.** Forcing `mdy` on a file containing `30-04-2026` must be refused — 30 is not a month. Honouring an impossible override reintroduces the silent corruption this plan exists to remove.
- **A `conflict` file imports nothing.** Evidence for both orders means no single rule can read it correctly.
- `localeParse.ts` is a **pure module** — no React, Supabase or Redux imports.
- ISO dates (`YYYY-MM-DD`) are unambiguous, contribute no evidence, and must never trigger a conflict.
- **Never commit to `main`.** Work happens on `fix/import-date-order` (already created off `main` @ `f98aa92`).
- Do **not** run `npm test`, `npx tsc --noEmit`, `npm run lint`, or a dev server. You MAY run `npx jest src/lib/utils/localeParse` and `npx jest src/app/dashboard/sales` for files you touch. The user runs the full gates.
- Docs ship in the **same commit** as the code (AGENTS.md).
- Husky hooks enforce: `pre-commit` = `tsc --noEmit` + `eslint` + project verifier; `pre-push` = `jest` + `next build`.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/utils/localeParse.ts` | `DateOrder`, `DateOrderDetection`, `detectDateOrder`, `parseFlexibleDate(input, order)` — **pure** |
| `src/lib/utils/localeParse.test.ts` | detection and parsing, both orders, conflict and ambiguity |
| `src/app/dashboard/sales/_components/importFormats.ts` | thread `order` into `validateRowForFormat` |
| `src/app/dashboard/sales/_components/ImportSalesModal.tsx` | run detection, render the override, refuse conflicts |
| `src/app/dashboard/sales/CLAUDE.md` + `SKILL.md`, `src/lib/utils/SKILL.md` | docs |

---

### Task 1: `detectDateOrder` and an order-aware `parseFlexibleDate`

**Files:**
- Modify: `src/lib/utils/localeParse.ts`
- Test: `src/lib/utils/localeParse.test.ts`

**Interfaces:**
- Produces:
  - `export type DateOrder = "dmy" | "mdy";`
  - `export interface DateOrderDetection { order: DateOrder; confident: boolean; conflict?: { dayFirstSample: string; monthFirstSample: string } }`
  - `export function detectDateOrder(values: string[]): DateOrderDetection`
  - `export function parseFlexibleDate(input: string | undefined, order?: DateOrder): string | null`
  Tasks 2 and 3 consume all four.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/utils/localeParse.test.ts`:

```typescript
import { detectDateOrder, parseFlexibleDate } from "./localeParse";

describe("detectDateOrder", () => {
  it("proves day-first from a first field over 12", () => {
    // 30-04-2026 is real: it is in the April Amazon report.
    const d = detectDateOrder(["30-04-2026", "10-04-2026"]);
    expect(d.order).toBe("dmy");
    expect(d.confident).toBe(true);
    expect(d.conflict).toBeUndefined();
  });

  it("proves month-first from a second field over 12", () => {
    const d = detectDateOrder(["04/30/2026", "04/10/2026"]);
    expect(d.order).toBe("mdy");
    expect(d.confident).toBe(true);
  });

  it("reports ambiguity when every date reads both ways, defaulting to dmy", () => {
    const d = detectDateOrder(["10-04-2026", "05-06-2026"]);
    expect(d.order).toBe("dmy");
    expect(d.confident).toBe(false);
    expect(d.conflict).toBeUndefined();
  });

  it("reports a conflict when the file proves both", () => {
    const d = detectDateOrder(["30-04-2026", "04/30/2026"]);
    expect(d.confident).toBe(false);
    expect(d.conflict).toEqual({
      dayFirstSample: "30-04-2026",
      monthFirstSample: "04/30/2026",
    });
  });

  it("ignores ISO dates entirely — they never cause a conflict", () => {
    const d = detectDateOrder(["2026-04-30", "2026-04-10", "30-04-2026"]);
    expect(d.order).toBe("dmy");
    expect(d.confident).toBe(true);
    expect(d.conflict).toBeUndefined();
  });

  it("ignores dot-separated dates — they are day-first by convention", () => {
    const d = detectDateOrder(["15.01.2024", "30.01.2024"]);
    expect(d.confident).toBe(false);
  });

  it("ignores blank and malformed values without throwing", () => {
    const d = detectDateOrder(["", "   ", "not a date", "10-4-26", "30-04-2026"]);
    expect(d.order).toBe("dmy");
    expect(d.confident).toBe(true);
  });

  it("returns ambiguous for an empty list", () => {
    const d = detectDateOrder([]);
    expect(d.order).toBe("dmy");
    expect(d.confident).toBe(false);
  });
});

describe("parseFlexibleDate with an explicit order", () => {
  it("defaults to day-first when no order is given", () => {
    expect(parseFlexibleDate("10-04-2026")).toBe("2026-04-10");
  });

  it("reads month-first when told to", () => {
    expect(parseFlexibleDate("10-04-2026", "mdy")).toBe("2026-10-04");
  });

  it("rejects an impossible month-first reading", () => {
    // 30 is not a month, so mdy has no valid interpretation.
    expect(parseFlexibleDate("30-04-2026", "mdy")).toBeNull();
  });

  it("keeps dot-separated dates day-first even under mdy", () => {
    expect(parseFlexibleDate("15.01.2024", "mdy")).toBe("2024-01-15");
  });

  it("leaves ISO untouched under either order", () => {
    expect(parseFlexibleDate("2026-04-10", "mdy")).toBe("2026-04-10");
    expect(parseFlexibleDate("2026-04-10", "dmy")).toBe("2026-04-10");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx jest src/lib/utils/localeParse`
Expected: FAIL — `detectDateOrder` is not exported, and `parseFlexibleDate` takes one argument.

- [ ] **Step 3: Add the types and `detectDateOrder`**

In `src/lib/utils/localeParse.ts`, directly above `parseFlexibleDate`:

```typescript
export type DateOrder = "dmy" | "mdy";

export interface DateOrderDetection {
  /** The order to parse with. Always usable — falls back to "dmy" when undecidable. */
  order: DateOrder;
  /** True when the file contained hard evidence for this order. */
  confident: boolean;
  /** Present ONLY when the file contains evidence for BOTH orders. Refuse the import. */
  conflict?: { dayFirstSample: string; monthFirstSample: string };
}

// Matching separators only: "10-04/2026" is malformed, not evidence.
// Dot-separated dates are deliberately excluded — DD.MM.YYYY is the German
// convention and MM.DD.YYYY does not occur, so they carry no evidence.
const SEPARATED_DATE = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/;

/**
 * Decide whether a file's dates are day-first or month-first from evidence
 * rather than assumption. `10-04-2026` is genuinely ambiguous; `30-04-2026`
 * is not, because 30 cannot be a month.
 *
 * Silently guessing is what mis-dated 145 live orders — see the spec.
 */
export function detectDateOrder(values: string[]): DateOrderDetection {
  let dayFirstSample: string | undefined;
  let monthFirstSample: string | undefined;

  for (const raw of values) {
    const s = raw?.trim();
    if (!s) continue;
    const m = SEPARATED_DATE.exec(s);
    if (!m) continue; // ISO, dot-separated or malformed — no evidence either way
    const first = Number(m[1]);
    const second = Number(m[3]);
    if (first > 12 && second <= 12) dayFirstSample ??= s;
    else if (second > 12 && first <= 12) monthFirstSample ??= s;
  }

  if (dayFirstSample && monthFirstSample) {
    return { order: "dmy", confident: false, conflict: { dayFirstSample, monthFirstSample } };
  }
  if (dayFirstSample) return { order: "dmy", confident: true };
  if (monthFirstSample) return { order: "mdy", confident: true };
  return { order: "dmy", confident: false };
}
```

- [ ] **Step 4: Add the `order` parameter to `parseFlexibleDate`**

Replace the `de` branch of `parseFlexibleDate` and its signature:

```typescript
export function parseFlexibleDate(
  input: string | undefined,
  order: DateOrder = "dmy",
): string | null {
  const s = input?.trim();
  if (!s) return null;

  let year: number, month: number, day: number;
  const iso = ISO_DATE.exec(s);
  const de = iso ? null : DE_DATE.exec(s);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (de) {
    const first = Number(de[1]);
    const second = Number(de[2]);
    year = Number(de[3]);
    // A dot-separated date is always day-first: DD.MM.YYYY is the German
    // convention and MM.DD.YYYY does not occur, so `order` must not flip it.
    if (order === "mdy" && !s.includes(".")) {
      month = first; day = second;
    } else {
      day = first; month = second;
    }
  } else {
    return null;
  }
```

Leave the rest of the function — the range check, the real-calendar check and the return — exactly as it is. The existing `month < 1 || month > 12` check is what makes `parseFlexibleDate("30-04-2026", "mdy")` return `null`.

Also update the JSDoc above the function to mention the `order` parameter and that it defaults to `"dmy"`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx jest src/lib/utils/localeParse`
Expected: PASS, including both pre-existing tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/localeParse.ts src/lib/utils/localeParse.test.ts
git commit -m "feat(import): detect date order from file evidence

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Thread the order through `validateRowForFormat`

**Files:**
- Modify: `src/app/dashboard/sales/_components/importFormats.ts`
- Test: `src/app/dashboard/sales/_components/importFormats.test.ts`

**Interfaces:**
- Consumes: `DateOrder` and `parseFlexibleDate(input, order)` from Task 1.
- Produces: `validateRowForFormat(format, raw, rowNum, dateOrder?: DateOrder)` — a fourth optional parameter defaulting to `"dmy"`. Task 3 passes the detected value.

- [ ] **Step 1: Write the failing tests**

Append to `importFormats.test.ts`:

```typescript
describe("validateRowForFormat honours the date order", () => {
  const amazonRow = {
    order_id: "028-5781430-5293162",
    date: "10-04-2026",
    product_name: "Textilstifte",
    quantity: "1",
    unit_price: "8.05",
    total: "8.05",
    currency: "EUR",
    status: "SALE",
  };

  it("defaults to day-first when no order is passed", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, amazonRow, 2);
    expect(row.error).toBeNull();
    expect(row.data?.date).toBe("2026-04-10");
  });

  it("reads month-first when told to", () => {
    const row = validateRowForFormat(IMPORT_FORMATS.amazon, amazonRow, 2, "mdy");
    expect(row.data?.date).toBe("2026-10-04");
  });

  it("errors when the month-first reading is impossible", () => {
    const row = validateRowForFormat(
      IMPORT_FORMATS.amazon,
      { ...amazonRow, date: "30-04-2026" },
      2,
      "mdy",
    );
    expect(row.error).toContain("date");
  });

  it("applies the order to the generic format too", () => {
    const row = validateRowForFormat(
      IMPORT_FORMATS.generic,
      { date: "10-04-2026", product_name: "Widget", quantity: "1", unit_price: "9.99" },
      2,
      "mdy",
    );
    expect(row.data?.date).toBe("2026-10-04");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: FAIL — `validateRowForFormat` takes three arguments; the `"mdy"` cases return `2026-04-10`.

- [ ] **Step 3: Add the parameter**

Import the type alongside the existing helpers:

```typescript
import { parseLocaleNumber, parseFlexibleDate, type DateOrder } from "@/lib/utils/localeParse";
```

Extend the signature:

```typescript
export function validateRowForFormat(
  format: ImportFormat,
  raw: Record<string, string>,
  rowNum: number,
  dateOrder: DateOrder = "dmy",
): ParsedRow {
```

Then change the single call site inside the function (currently `const date = parseFlexibleDate(raw.date);`) to:

```typescript
  const date = parseFlexibleDate(raw.date, dateOrder);
```

That is the only `parseFlexibleDate` call in the file — verified by grep across `src/`, `importFormats.ts` holds the only call site in the codebase outside `localeParse.ts` itself.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx jest src/app/dashboard/sales/_components/importFormats`
Expected: PASS, including every pre-existing test — the default keeps them unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/sales/_components/importFormats.ts src/app/dashboard/sales/_components/importFormats.test.ts
git commit -m "feat(sales-import): pass the detected date order into row validation

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Modal — detection, conflict refusal, override selector

**Files:**
- Modify: `src/app/dashboard/sales/_components/ImportSalesModal.tsx`

**Interfaces:**
- Consumes: `detectDateOrder`, `DateOrder`, `DateOrderDetection` (Task 1); the fourth parameter of `validateRowForFormat` (Task 2).

- [ ] **Step 1: Add the imports and state**

```typescript
import { detectDateOrder, type DateOrder, type DateOrderDetection } from "@/lib/utils/localeParse";
```

Alongside the other `useState` declarations:

```typescript
  // null = trust detection. A non-null value is the user forcing an order,
  // which is only honoured when the file has no hard evidence to the contrary.
  const [dateOrderOverride, setDateOrderOverride] = useState<DateOrder | null>(null);
  const [dateDetection, setDateDetection] = useState<DateOrderDetection | null>(null);
```

- [ ] **Step 2: Run detection inside `parseAndValidate`**

**First change its signature**, so the `override` used below exists:

```typescript
  async function parseAndValidate(
    source: ParsedSource,
    fmtId: ImportFormatId,
    override: DateOrder | null,
  ) {
```

`parseAndValidate` currently canonicalises and validates in one `rows.map(...)`. Detection needs the canonicalised rows first, so split it. Replace the `const validated = rows.map(...)` line with:

```typescript
    // Canonicalise first so the `date` column is resolved, then decide the
    // order from the whole file BEFORE validating any row. Guessing per-row is
    // what mis-dated 145 live orders.
    const canonical = rows.map((row) => canonicalizeRow(row, mapping));
    const detection = detectDateOrder(canonical.map((r) => r.date ?? ""));
    setDateDetection(detection);

    if (detection.conflict) {
      setParsed([{
        rowNum: 0,
        data: null,
        error: `This file mixes date formats — it contains "${detection.conflict.dayFirstSample}" (day first) and "${detection.conflict.monthFirstSample}" (month first). No single rule can read both correctly. Fix the file before importing.`,
      }]);
      return;
    }

    if (override !== null && detection.confident && override !== detection.order) {
      const proven = detection.order === "dmy" ? "day first (DD-MM-YYYY)" : "month first (MM-DD-YYYY)";
      setParsed([{
        rowNum: 0,
        data: null,
        error: `This file can only be read ${proven} — it contains a date whose other reading is not a real month. Set the date format back to Auto.`,
      }]);
      return;
    }

    const dateOrder: DateOrder = override ?? detection.order;
    const validated = canonical.map((row, i) =>
      validateRowForFormat(fmt, row, i + 2, dateOrder),
    );
```

- [ ] **Step 3: Thread the override through every caller**

The signature changed in Step 2, so both existing callers now fail to compile. Update `handleFormatChange` and `handleFile` to pass `dateOrderOverride` as the third argument, and add a handler that re-runs parsing when the override changes:

```typescript
  function handleDateOrderChange(next: DateOrder | null) {
    setDateOrderOverride(next);
    setImportError(null);
    if (parsedSource !== null) {
      void parseAndValidate(parsedSource, formatId, next);
    }
  }
```

- [ ] **Step 4: Clear both on reset**

Add to the modal's `reset()`:

```typescript
    setDateOrderOverride(null);
    setDateDetection(null);
```

- [ ] **Step 5: Render the selector and what was detected**

Next to the format selector, visible once a file is loaded:

```tsx
{dateDetection && (
  <label className="flex items-center gap-2 text-sm">
    Date format
    <select
      value={dateOrderOverride ?? "auto"}
      onChange={(e) =>
        handleDateOrderChange(e.target.value === "auto" ? null : (e.target.value as DateOrder))
      }
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
    >
      <option value="auto">
        {dateDetection.confident
          ? `Auto — detected ${dateDetection.order === "dmy" ? "DD-MM-YYYY" : "MM-DD-YYYY"}`
          : "Auto — could not tell, assuming DD-MM-YYYY"}
      </option>
      <option value="dmy">Day first (DD-MM-YYYY)</option>
      <option value="mdy">Month first (MM-DD-YYYY)</option>
    </select>
  </label>
)}
{dateDetection && !dateDetection.confident && !dateDetection.conflict && (
  <p className="text-xs text-[var(--color-text-muted)]">
    Every date in this file reads the same either way, so the format could not be
    detected. Check a few dates in the preview before importing.
  </p>
)}
```

- [ ] **Step 6: Ask the user to verify in the browser**

Do not start a dev server. Ask the user to import the April Amazon sheet and confirm: the selector reads *"Auto — detected DD-MM-YYYY"*, and the imported orders all land in April rather than spread across twelve months. Then ask them to force *Month first* and confirm the import is refused with the "can only be read day first" message rather than silently producing October dates.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/sales/_components/ImportSalesModal.tsx
git commit -m "feat(sales-import): detect date order per file, with an override

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Documentation

**Files:**
- Modify: `src/lib/utils/SKILL.md`
- Modify: `src/app/dashboard/sales/CLAUDE.md`
- Modify: `src/app/dashboard/sales/SKILL.md`

- [ ] **Step 1: `src/lib/utils/SKILL.md`**

Its `parseFlexibleDate` entry currently documents a one-argument function. Update the signature to `parseFlexibleDate(input, order?) → string | null`, state that `order` defaults to `"dmy"`, and add `detectDateOrder(values) → DateOrderDetection` beside it.

- [ ] **Step 2: `src/app/dashboard/sales/CLAUDE.md`**

Its CSV import section says dates are accepted as `YYYY-MM-DD` or `DD.MM.YYYY`. Document that the order is now detected per file from evidence, that the user can override it, and that a file containing evidence for both orders is refused outright.

- [ ] **Step 3: `src/app/dashboard/sales/SKILL.md` gotchas**

Add these three, each of which cost real data:

> `10-04-2026` is ambiguous. The importer used to assume day-first for every `N-N-YYYY` string; a month-first file therefore imported every date whose day was 1–12 wrongly, with no error. That mis-dated 145 live orders in `tenant_k2_textil` — they landed on the 4th of twelve different months. `detectDateOrder` now decides from file evidence instead.

> A dot-separated date (`15.01.2024`) is ALWAYS day-first, even when the detected order is `mdy`. `DD.MM.YYYY` is the German convention and `MM.DD.YYYY` does not occur, so `parseFlexibleDate` deliberately ignores `order` for them.

> Importing the `.xlsx` directly sidesteps ambiguity entirely **when the sheet's date column holds real dates** — `excel.ts` converts those to ISO before parsing. It does not help when the cells hold date-formatted text, which marketplace exports often do.

- [ ] **Step 4: Ask the user to run the full gates**

```bash
npx tsc --noEmit && npm run lint && npx jest && uv run .claude/verifiers/verify_changes.py
```

Report the actual output. Do not claim success without it.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(import): document per-file date-order detection

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Not in this plan

- **The 145 mis-dated rows.** The repair SQL is in the spec's *Data repair* section and is the user's to run — the MCP servers are `read_only=true`. It is independent of this code change.
- **Re-importing the April file** once this lands — the user's call.
- Two-digit years, per-column date order, and time components. All out of scope per the spec.
