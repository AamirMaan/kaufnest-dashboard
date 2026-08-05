# CSV import — ambiguous date order

**Date:** 2026-08-04
**Status:** Design approved by user. Ready for an implementation plan.
**Branch:** `fix/import-date-order` (off `main` @ `f98aa92`)

## Problem

`10-04-2026` is genuinely ambiguous — 10 April or 4 October. `parseFlexibleDate`
silently assumes day-first for every `N-N-YYYY` and `N/N/YYYY` string. When a
file is month-first, every date whose day is 1–12 is imported wrong, with no
error and nothing in the UI to notice.

This is not hypothetical. It has already corrupted live data.

## Evidence — 145 wrong rows in production

Verified against `tenant_k2_textil` on 2026-08-04. An Amazon April report was
imported at `2026-08-04 16:24:47`, producing 525 sales:

| Month | Orders | Day-of-month |
|---|---|---|
| Jan 2026 | 27 | **all on the 4th** |
| Feb 2026 | 8 | **all on the 4th** |
| Mar 2026 | 1 | **all on the 4th** |
| **Apr 2026** | **380** | spread 4th–30th ✓ |
| May–Dec 2026 | 109 | **all on the 4th** |

Every month outside April contains orders on exactly one day — the 4th. That is
`DD-04-2026` read as month `DD`, day `04`: `09-04-2026` (9 April) became
4 September, `12-04-2026` became 4 December. Days 13–30 cannot be months, so
they survived — those are the 380 correct April rows.

**145 orders are mis-dated** (36 = Jan + Feb + Mar, plus 109 = May–Dec), all
from that single import batch.

## Root cause

`parseFlexibleDate` (`src/lib/utils/localeParse.ts:75-100`) is itself correct
for day-first input:

```ts
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;      // 4-digit year first
const DE_DATE  = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;  // group 1 = DAY
```

`parseFlexibleDate("10-04-2026")` returns `2026-04-10`. Correct.

For the stored data to look as it does, **the imported file's dates were
month-first** — `04/10/2026` rather than `10-04-2026`. The sheet supplied to the
agent was day-first, so the imported copy had been reformatted, almost certainly
by Excel applying a US locale on export.

**The defect is ours regardless:** the parser guesses, and a wrong guess is
silent. `DE_DATE`'s separator class `[./-]` already accepts `/`, so a US-format
file parses "successfully" into wrong dates.

## Design

### Detect the order from the file, do not assume it

Before validating any row, scan every date cell in the file:

- a **first** field greater than 12 proves **day-first** (`30-04-2026`)
- a **second** field greater than 12 proves **month-first** (`04/30/2026`)
- ISO dates (`YYYY-MM-DD`) are unambiguous and contribute no evidence
- dot-separated dates (`15.01.2024`) are treated as day-first without
  detection — `DD.MM.YYYY` is the German convention and `MM.DD` effectively
  does not occur

Five outcomes:

| Outcome | Meaning | Behaviour |
|---|---|---|
| `dmy` | at least one first field > 12, none in second | use day-first |
| `mdy` | at least one second field > 12, none in first | use month-first |
| `ambiguous` | every date could be read either way | fall back to the override, default day-first, and say so prominently |
| `conflict` (evidence) | evidence for both | error, import nothing |
| `conflict` (separator) | the date column mixes `/` and `-` | error, import nothing — see below |

### Mixed-separator detection

Added after the initial design shipped, in response to Finding 1 of the
2026-08-05 whole-branch review (see the post-implementation correction above):
evidence-only detection cannot see a partial rewrite where the flipped cells
happen to have both fields ≤ 12. Before checking evidence, `detectDateOrder`
scans every `/`-or-`-`-separated date for its separator character. If more
than one distinct separator appears in the file, it refuses immediately —
`conflict.kind = "separator"` — carrying the first sample seen for each of
the two separators, independent of whatever day/month evidence those samples
do or don't carry. This check runs *before*, and takes priority over, the
evidence conflict check, since a file that both mixes separators and proves
both orders is still fundamentally a mixed/rewritten file.

Dot-separated dates are excluded from this check entirely, same as from
evidence collection — `DD.MM.YYYY` is the only convention in use for them, so
a `.` can never indicate a rewrite the way a `/`-vs-`-` mismatch does.

The April file contains `30-04-2026`, so detection locks it to `dmy`
immediately. A US-exported copy, uniformly `04/30/2026`, would lock to `mdy`.
Either of those *uniform* files would have landed correctly.

**Post-implementation correction (see the 2026-08-05 whole-branch review):**
the real incident file was neither of those — it was not uniformly
reformatted. Excel converted only the cells it could read as a valid US date
(both fields ≤ 12) to `04/09/2026`, and left the rest as `30-04-2026` text.
That is exactly why 380 April rows survived correctly (days 13–30 can't be a
month, so Excel couldn't touch them) while 145 others were silently flipped.
Evidence-only detection, as designed above, **cannot catch this shape of
corruption**: the flipped cells have both fields ≤ 12 by construction, so
they never produce month-first evidence, and the surviving day-first cells
confidently "prove" `dmy` — the file passes detection and imports clean,
mis-dating the same 145 rows a second time. Re-importing this file today,
after the fix below, would NOT have landed correctly on evidence alone.

The signal evidence-based detection misses is that the flipped cells and the
surviving cells use **different separators** (`/` vs `-`) — a spreadsheet
tool rewrote some cells and not others. `detectDateOrder` therefore also
refuses a file whose date column mixes separators, regardless of what the
per-value evidence says. See "Mixed-separator detection" below.

`conflict` means the file cannot be trusted — either because it has evidence
for both orders, or because its date column mixes separators — and importing
any of it would be guessing.

### Manual override in the modal

Detection is shown, and overridable. A selector with three states:

- **Auto-detected (DD-MM-YYYY)** — default when detection succeeded, naming what
  was detected so it is visible rather than implicit
- **Day first (DD-MM-YYYY)**
- **Month first (MM-DD-YYYY)**

The override exists for the `ambiguous` case — a small file where every day
happens to be ≤ 12 — and as an escape hatch when detection is right about the
format but the user knows better. Choosing an override that contradicts hard
evidence (e.g. forcing `mdy` on a file containing `30-04-2026`) must be refused,
not silently honoured: that date has no valid month-first reading.

### Function signatures

```ts
export type DateOrder = "dmy" | "mdy";

export interface DateOrderDetection {
  /** The order to parse with. ALWAYS usable — falls back to "dmy" when undecidable. */
  order: DateOrder;
  /** True when the file contained hard evidence for this order. */
  confident: boolean;
  /**
   * Present when the file cannot be trusted to read with a single rule.
   * `"evidence"`: hard evidence for BOTH orders. `"separator"`: the date
   * column mixes `/` and `-` (see "Mixed-separator detection" above) — added
   * post-implementation, after Finding 1 of the 2026-08-05 whole-branch
   * review showed evidence-only detection misses a partial-rewrite file.
   * Refuse the import either way.
   */
  conflict?: { kind: "evidence" | "separator"; sampleA: string; sampleB: string };
}

export function detectDateOrder(values: string[]): DateOrderDetection;
export function parseFlexibleDate(input: string | undefined, order?: DateOrder): string | null;
```

`order` is deliberately never `null`, even on conflict — every consumer would
otherwise need null-handling for a case where it must refuse the import anyway.
Callers check `conflict` first and only then read `order`.

`order` defaults to `"dmy"`, so every existing call site and test keeps its
current behaviour untouched. Only the import path passes a detected value.

## The `.xlsx` path already sidesteps this — partially

`ImportSalesModal` already accepts `.xlsx`/`.xls` (`:492-493`), and
`src/lib/utils/excel.ts:17-22` converts a real `Date` cell to ISO
`YYYY-MM-DD` before the pipeline ever sees it. ISO is unambiguous, so a
spreadsheet whose date column holds **real date values** cannot be misread.

The user exported `Q2-April-2026.xlsx` to CSV and imported that, which is
exactly where the reformatting happened. Importing the `.xlsx` directly is a
zero-code workaround worth trying immediately.

It is **not** a fix:

- If the xlsx cells hold date-formatted **text** rather than real dates —
  common in marketplace exports — `cellToString` returns the string unchanged
  and the ambiguity is back.
- CSV remains a first-class supported input; leaving it silently corrupting is
  not acceptable.

So the detection work stands. This finding belongs in the docs as the
recommended workflow, and it should be verified before assuming it helps: check
whether the April sheet's date column is text or dates.

## Blast radius

`parseFlexibleDate` is shared by all three import formats (`generic`, `amazon`,
`ebay`) and has existing tests. Behaviour changes **only** when a file proves
month-first — which today silently corrupts. Every day-first and ISO file parses
exactly as before. This is strictly an improvement, not a semantic change.

## Data repair — 145 rows, separate from the code change

Run against `tenant_k2_textil`. Preview first:

```sql
select id, external_order_id, date as wrong_date,
       make_date(2026, 4, extract(month from date)::int) as correct_date
from tenant_k2_textil.sales
where platform = 'amazon'
  and extract(day from date) = 4
  and extract(month from date) <> 4
  and created_at = '2026-08-04 16:24:47.337364+00'
order by date;
```

Then apply the same predicate as an `update ... set date = make_date(...)`.

Pinning `created_at` to that batch prevents a later legitimate order on the 4th
of some month being caught. `2026-04-04` is deliberately untouched — it reads
identically either way.

**This is the user's to run.** The MCP servers are `read_only=true`.

## Out of scope

- Two-digit years (`10-04-26`) — not produced by any format in use.
- Per-column date order (a file with one day-first and one month-first column).
- Time components; the importer stores dates only.
- Re-importing the April file — the user's call once this lands.

## Testing

Per AGENTS.md: no dev server, no `curl`, and the agent does not run
`npm test`/`tsc`/`lint` mid-task.

`localeParse.ts` is pure with colocated tests. Cases that must be covered:

- `detectDateOrder(["30-04-2026", "10-04-2026"])` → `dmy`, confident
- `detectDateOrder(["04/30/2026", "04/10/2026"])` → `mdy`, confident
- `detectDateOrder(["10-04-2026", "05-06-2026"])` → ambiguous, defaults `dmy`
- `detectDateOrder(["30-04-2026", "04-30-2026"])` → evidence conflict (same
  separator, both orders proven), with samples
- `detectDateOrder(["30-04-2026", "04/09/2026"])` → separator conflict — the
  real incident shape: the second value alone proves neither order, but the
  mixed `/`/`-` still refuses the file
- `detectDateOrder(["30-04-2026", "10-04-2026"])` → confident `dmy`, no
  conflict (consistent `-` separator)
- `detectDateOrder(["04/30/2026", "04/09/2026"])` → confident `mdy`, no
  conflict (consistent `/` separator)
- ISO values contribute no evidence and never cause a conflict
- dot-separated values are day-first and contribute no evidence
- blank and malformed values are ignored rather than throwing
- `parseFlexibleDate("10-04-2026", "mdy")` → `2026-10-04`
- `parseFlexibleDate("10-04-2026")` with no order → `2026-04-10` (unchanged default)
- `parseFlexibleDate("30-04-2026", "mdy")` → `null` (month 30 is invalid)
- every pre-existing `parseFlexibleDate` test still passes untouched

## Files affected

- `src/lib/utils/localeParse.ts` + its colocated test
- `src/app/dashboard/sales/_components/ImportSalesModal.tsx` — detection call,
  the override selector, the conflict error
- `src/app/dashboard/sales/_components/importFormats.ts` — thread the order
  through `validateRowForFormat`
- `src/app/dashboard/sales/CLAUDE.md` + `SKILL.md`

**There is exactly one `parseFlexibleDate` call site outside the module itself**
— `importFormats.ts:319`. Verified by grep across `src/`. `excel.ts` only
mentions it in a comment. That makes threading the parameter a genuinely small
change rather than a wide refactor.

## Decisions taken

| Decision | Chosen | Rejected because |
|---|---|---|
| Ambiguity | Detect from file evidence | Guessing is what corrupted 145 rows |
| Undecidable file | Override selector, default day-first, stated in the UI | Silently defaulting is the current bug |
| Conflicting evidence | Error, import nothing | A mixed-format file cannot be parsed correctly by any single rule |
| Override vs evidence | Evidence wins; contradicting overrides refused | Honouring an impossible override reintroduces silent corruption |
| Dot separator | Always day-first, no detection | `MM.DD.YYYY` does not occur; avoids needless ambiguity prompts |
| Default `order` param | `"dmy"` | Keeps every existing call site and test unchanged |
| Sequencing | Before the refund redesign | Corruption is live on every import; fix is small and self-contained |
