# Invoice Custom Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ephemeral "Bill To" + dynamic extra fields section to the invoice generation modal and PDF output.

**Architecture:** `InvoiceModal` gains local `opts` state (customer name, address, extra fields) that is passed to the three generate functions. A new `addBillTo` helper in `generateInvoice.ts` renders the block between the header rule and the data table. No persistence — state resets on every modal open.

**Tech Stack:** React local state, jsPDF, jspdf-autotable, TypeScript

## Global Constraints

- Branch: `feat/invoice-custom-fields`
- No Supabase, Redux, or new files — exactly 2 source files change
- Tailwind v4 CSS variable syntax: `(--color-var)` not `[var(--color-var)]`
- Dark mode via `[data-theme="dark"]`, never `dark:` Tailwind variants
- No dev server — ask user to test in browser after implementation
- After code changes, update `CLAUDE.md` and any affected `SKILL.md` per project rules

---

### Task 1: Export `InvoiceOptions` type and add `addBillTo` helper to `generateInvoice.ts`

**Files:**
- Modify: `src/lib/utils/generateInvoice.ts`

**Interfaces:**
- Produces: `InvoiceOptions` (exported interface consumed by Task 2), `addBillTo` private helper (used by all three generate functions in this same file)

- [ ] **Step 1: Add the `InvoiceOptions` interface at the top of the file (after the imports)**

Open `src/lib/utils/generateInvoice.ts`. After the import line, add:

```ts
export interface InvoiceOptions {
  customerName: string;
  customerAddress: string;
  extraFields: { label: string; value: string }[];
}
```

- [ ] **Step 2: Add the `addBillTo` private helper after `todayFormatted()`**

Insert the following function after `todayFormatted()` and before the `// ─── Header + footer helpers` comment block:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addBillTo(doc: any, options: InvoiceOptions, startY: number): number {
  const { customerName, customerAddress, extraFields } = options;
  const hasCustomer = customerName.trim() || customerAddress.trim();
  const hasExtra = extraFields.some((f) => f.label.trim() || f.value.trim());
  if (!hasCustomer && !hasExtra) return startY;

  let y = startY;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(90, 90, 90);
  doc.text("Bill To:", 14, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  if (customerName.trim()) {
    doc.text(customerName.trim(), 14, y);
    y += 5;
  }
  if (customerAddress.trim()) {
    customerAddress
      .trim()
      .split("\n")
      .forEach((line) => {
        doc.text(line.trim(), 14, y);
        y += 5;
      });
  }

  if (hasExtra) {
    y += 2;
    extraFields.forEach(({ label, value }) => {
      if (!label.trim() && !value.trim()) return;
      doc.text(`${label.trim()}: ${value.trim()}`, 14, y);
      y += 5;
    });
  }

  return y + 4;
}
```

- [ ] **Step 3: Update `generateSalesInvoice` signature and call `addBillTo`**

Change the function signature from:
```ts
export async function generateSalesInvoice(sales: Sale[], settings: CompanyProfile) {
```
to:
```ts
export async function generateSalesInvoice(
  sales: Sale[],
  settings: CompanyProfile,
  options: InvoiceOptions = { customerName: "", customerAddress: "", extraFields: [] }
) {
```

Then find these two lines inside the function:
```ts
  const startY = addHeader(doc, settings, invoiceNumber, "SALES INVOICE");

  const rows = sales.map
```

Replace them with:
```ts
  const headerY = addHeader(doc, settings, invoiceNumber, "SALES INVOICE");
  const startY = addBillTo(doc, options, headerY);

  const rows = sales.map
```

- [ ] **Step 4: Update `generateExpensesInvoice` signature and call `addBillTo`**

Change the function signature from:
```ts
export async function generateExpensesInvoice(expenses: Expense[], settings: CompanyProfile) {
```
to:
```ts
export async function generateExpensesInvoice(
  expenses: Expense[],
  settings: CompanyProfile,
  options: InvoiceOptions = { customerName: "", customerAddress: "", extraFields: [] }
) {
```

Then find:
```ts
  const startY = addHeader(doc, settings, invoiceNumber, "EXPENSE REPORT");

  const rows = expenses.map
```

Replace with:
```ts
  const headerY = addHeader(doc, settings, invoiceNumber, "EXPENSE REPORT");
  const startY = addBillTo(doc, options, headerY);

  const rows = expenses.map
```

- [ ] **Step 5: Update `generatePurchasesInvoice` signature and call `addBillTo`**

Change the function signature from:
```ts
export async function generatePurchasesInvoice(purchases: Purchase[], settings: CompanyProfile) {
```
to:
```ts
export async function generatePurchasesInvoice(
  purchases: Purchase[],
  settings: CompanyProfile,
  options: InvoiceOptions = { customerName: "", customerAddress: "", extraFields: [] }
) {
```

Then find:
```ts
  const startY = addHeader(doc, settings, invoiceNumber, "PURCHASE REPORT");

  const rows = purchases.map
```

Replace with:
```ts
  const headerY = addHeader(doc, settings, invoiceNumber, "PURCHASE REPORT");
  const startY = addBillTo(doc, options, headerY);

  const rows = purchases.map
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/generateInvoice.ts
git commit -m "feat(invoice): export InvoiceOptions type + addBillTo PDF helper"
```

---

### Task 2: Update `InvoiceModal` with customer info UI and extra fields

**Files:**
- Modify: `src/components/modals/InvoiceModal.tsx`

**Interfaces:**
- Consumes: `InvoiceOptions` from `@/lib/utils/generateInvoice`
- Consumes: `generateSalesInvoice(items, companyProfile, opts)`, `generateExpensesInvoice(items, companyProfile, opts)`, `generatePurchasesInvoice(items, companyProfile, opts)` — updated signatures from Task 1

- [ ] **Step 1: Import `InvoiceOptions` and add `Plus` / `X` icons**

At the top of `src/components/modals/InvoiceModal.tsx`, change:
```ts
import { FileDown, AlertCircle } from "lucide-react";
```
to:
```ts
import { FileDown, AlertCircle, Plus, X } from "lucide-react";
```

And add the `InvoiceOptions` import to the generateInvoice import line:
```ts
import {
  generateSalesInvoice,
  generateExpensesInvoice,
  generatePurchasesInvoice,
  type InvoiceOptions,
} from "@/lib/utils/generateInvoice";
```

- [ ] **Step 2: Add `opts` local state inside `InvoiceModal`**

Inside `InvoiceModal`, after the existing `const [generating, setGenerating] = useState(false);` line, add:

```ts
  const [opts, setOpts] = useState<InvoiceOptions>({
    customerName: "",
    customerAddress: "",
    extraFields: [],
  });

  function addExtraField() {
    setOpts((prev) => ({ ...prev, extraFields: [...prev.extraFields, { label: "", value: "" }] }));
  }

  function updateExtraField(index: number, key: "label" | "value", val: string) {
    setOpts((prev) => {
      const next = prev.extraFields.map((f, i) => i === index ? { ...f, [key]: val } : f);
      return { ...prev, extraFields: next };
    });
  }

  function removeExtraField(index: number) {
    setOpts((prev) => ({ ...prev, extraFields: prev.extraFields.filter((_, i) => i !== index) }));
  }
```

- [ ] **Step 3: Pass cleaned `opts` to the generate functions in `handleGenerate`**

Replace the existing `handleGenerate` function:
```ts
  async function handleGenerate() {
    if (!companyProfile) return;
    setGenerating(true);
    try {
      if (type === "sale") await generateSalesInvoice(items as Sale[], companyProfile);
      else if (type === "expense") await generateExpensesInvoice(items as Expense[], companyProfile);
      else await generatePurchasesInvoice(items as Purchase[], companyProfile);
      onSuccess?.();
    } finally {
      setGenerating(false);
      onClose();
    }
  }
```

With:
```ts
  async function handleGenerate() {
    if (!companyProfile) return;
    setGenerating(true);
    const cleanedOpts: InvoiceOptions = {
      ...opts,
      extraFields: opts.extraFields.filter((f) => f.label.trim() || f.value.trim()),
    };
    try {
      if (type === "sale") await generateSalesInvoice(items as Sale[], companyProfile, cleanedOpts);
      else if (type === "expense") await generateExpensesInvoice(items as Expense[], companyProfile, cleanedOpts);
      else await generatePurchasesInvoice(items as Purchase[], companyProfile, cleanedOpts);
      onSuccess?.();
    } finally {
      setGenerating(false);
      onClose();
    }
  }
```

- [ ] **Step 4: Add Customer Information and Additional Fields UI sections**

Inside the `<Modal>` body, after the closing `</div>` of the records summary card (the `rounded-[var(--radius-card)]` div) and before the closing `<p className="text-xs ...">` hint, add:

```tsx
        {/* Customer Information */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
            Customer Information
          </p>
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Customer Name
              </label>
              <input
                type="text"
                value={opts.customerName}
                onChange={(e) => setOpts((prev) => ({ ...prev, customerName: e.target.value }))}
                placeholder="e.g. John Doe"
                className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Address
              </label>
              <textarea
                rows={2}
                value={opts.customerAddress}
                onChange={(e) => setOpts((prev) => ({ ...prev, customerAddress: e.target.value }))}
                placeholder="Street, City, ZIP"
                className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-none"
              />
            </div>
          </div>
        </div>

        {/* Additional Fields */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
            Additional Fields
          </p>
          <div className="space-y-1.5">
            {opts.extraFields.map((field, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={field.label}
                  onChange={(e) => updateExtraField(i, "label", e.target.value)}
                  placeholder="Label"
                  className="flex-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
                <input
                  type="text"
                  value={field.value}
                  onChange={(e) => updateExtraField(i, "value", e.target.value)}
                  placeholder="Value"
                  className="flex-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
                <button
                  type="button"
                  onClick={() => removeExtraField(i)}
                  className="p-1.5 rounded-[var(--radius-btn)] text-[var(--color-text-faint)] hover:text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)] transition-colors"
                  title="Remove field"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addExtraField}
              className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-base)] transition-colors py-0.5"
            >
              <Plus size={13} />
              Add Field
            </button>
          </div>
        </div>
```

- [ ] **Step 5: Commit**

```bash
git add src/components/modals/InvoiceModal.tsx
git commit -m "feat(invoice): Bill To + dynamic extra fields UI in InvoiceModal"
```

---

### Task 3: Update docs

**Files:**
- Modify: `CLAUDE.md` (shared deps section — note `InvoiceOptions` is now exported from `generateInvoice`)
- Modify: `src/app/dashboard/sales/SKILL.md` (or whichever SKILL.md references InvoiceModal / generateInvoice)

- [ ] **Step 1: Update `CLAUDE.md` shared deps entry for generateInvoice**

In `CLAUDE.md`, find the line:
```
- `src/lib/*` — Supabase clients, `utils/{audit,currency,date,filters,permissions,generateInvoice}`
```

Update it to note the export:
```
- `src/lib/*` — Supabase clients, `utils/{audit,currency,date,filters,permissions,generateInvoice}` (`generateInvoice` also exports `InvoiceOptions` — import it from here, not a separate types file)
```

- [ ] **Step 2: Commit docs**

```bash
git add CLAUDE.md
git commit -m "docs: note InvoiceOptions export in generateInvoice shared dep entry"
```

---

## Self-Review

**Spec coverage:**
- ✅ `InvoiceOptions` interface exported from `generateInvoice.ts` — Task 1 Step 1
- ✅ `addBillTo` helper (no-op when all empty) — Task 1 Step 2
- ✅ All three generate functions updated — Task 1 Steps 3–5
- ✅ `opts` local state initialized to empty defaults — Task 2 Step 2
- ✅ Customer Name + Address UI — Task 2 Step 4
- ✅ Dynamic extra fields (add/remove rows) — Task 2 Step 4
- ✅ `cleanedOpts` strips blank rows before passing to generate — Task 2 Step 3
- ✅ PDF renders Bill To block between header rule and table — Task 1 Step 2 (`addBillTo` returns `headerY` unchanged when empty)
- ✅ Ephemeral — `useState` with empty defaults, no localStorage/Redux — Task 2 Step 2
- ✅ Docs updated — Task 3

**Placeholder scan:** No TBDs, all code shown in full.

**Type consistency:** `InvoiceOptions` defined in Task 1 Step 1, imported in Task 2 Step 1. `addBillTo(doc, options, startY)` defined in Task 1 Step 2, called in Steps 3–5 with matching signature. `generateSalesInvoice(items, companyProfile, cleanedOpts)` — 3-arg call in Task 2 Step 3 matches updated signature in Task 1 Step 3. ✅
