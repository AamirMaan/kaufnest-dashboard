# Invoice Custom Fields — Design Spec

**Date:** 2026-06-29
**Status:** Approved

## Problem

When generating a Sales, Expense, or Purchase invoice, there is no way to add customer-facing information (name, address) or any other per-invoice metadata. Every generated PDF shows only company info and the data table — no "Bill To" block, no reference numbers, no custom annotations.

## Solution

Add an ephemeral (per-session, not persisted) customer info + dynamic extra fields UI to `InvoiceModal`, and render a "Bill To" block in the PDF between the header rule and the data table.

---

## Types

A single interface exported from `generateInvoice.ts` so `InvoiceModal` can import it:

```ts
export interface InvoiceOptions {
  customerName: string;
  customerAddress: string;
  extraFields: { label: string; value: string }[];
}
```

---

## UI — InvoiceModal (`src/components/modals/InvoiceModal.tsx`)

Local state initialized on every open:

```ts
const [opts, setOpts] = useState<InvoiceOptions>({
  customerName: "",
  customerAddress: "",
  extraFields: [],
});
```

State resets to empty defaults every time the modal opens (ephemeral — nothing persisted).

### Layout (below existing records summary card)

**Customer Information** section heading (`text-xs uppercase tracking-wide text-muted`):
- `Input` — label "Customer Name", placeholder "e.g. John Doe"
- `Textarea` (rows=2) — label "Address", placeholder "Street, City, ZIP"

**Additional Fields** section heading:
- Dynamic list: each entry renders as a single flex row:
  - `Input` (flex-1) — placeholder "Label"
  - `Input` (flex-1) — placeholder "Value"
  - Ghost `×` button — removes this row
- "+ Add Field" ghost button below the list — appends `{ label: "", value: "" }`
- No min/max on the number of rows

### Passing to generate functions

Before calling the generate function, strip extra field rows where both `label.trim()` and `value.trim()` are empty:

```ts
const cleanedOpts: InvoiceOptions = {
  ...opts,
  extraFields: opts.extraFields.filter(f => f.label.trim() || f.value.trim()),
};
```

Pass `cleanedOpts` as a second argument to whichever generate function is called.

---

## PDF — generateInvoice (`src/lib/utils/generateInvoice.ts`)

### New helper

```ts
function addBillTo(doc: any, options: InvoiceOptions, startY: number): number {
  const { customerName, customerAddress, extraFields } = options;
  const hasCustomer = customerName.trim() || customerAddress.trim();
  const hasExtra = extraFields.some(f => f.label.trim() || f.value.trim());
  if (!hasCustomer && !hasExtra) return startY; // no-op

  let y = startY;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(90, 90, 90);
  doc.text("Bill To:", 14, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  if (customerName.trim()) { doc.text(customerName.trim(), 14, y); y += 5; }
  if (customerAddress.trim()) {
    customerAddress.trim().split("\n").forEach(line => {
      doc.text(line.trim(), 14, y); y += 5;
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

  return y + 4; // gap before table
}
```

### Signature change (all three functions)

```ts
export async function generateSalesInvoice(
  sales: Sale[],
  settings: CompanyProfile,
  options: InvoiceOptions = { customerName: "", customerAddress: "", extraFields: [] }
)
```

Same pattern for `generateExpensesInvoice` and `generatePurchasesInvoice`.

### Call site (inside each generate function)

Replace the existing `addHeader(...)` return assignment:

```ts
// Before:
const startY = addHeader(doc, settings, invoiceNumber, "SALES INVOICE");

// After:
const headerY = addHeader(doc, settings, invoiceNumber, "SALES INVOICE");
const startY = addBillTo(doc, options, headerY);
```

---

## PDF Layout (with fields filled)

```
[Company Name]              [SALES INVOICE]
[Address / Phone / Email]   [Invoice #: ...]
[VAT ID / Tax ID]           [Date: ...]
─────────────────────────────────────────────
Bill To:
  John Doe
  123 Merchant Street
  Hamburg, 20095

  Reference: PO-12345
  Delivery Date: 15.07.2026

[DATA TABLE ...]
[TOTALS ...]
[FOOTER / Bank details]
```

If all fields are empty, the output is byte-for-byte identical to the current PDF (the `addBillTo` helper returns `startY` unchanged).

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/utils/generateInvoice.ts` | Export `InvoiceOptions`; add `addBillTo` helper; update all three generate function signatures |
| `src/components/modals/InvoiceModal.tsx` | Add `opts` local state; render Customer Info + Additional Fields UI; pass `cleanedOpts` to generate functions |

No Supabase, no Redux, no new files, no new routes.

---

## Out of Scope

- Persisting customer info between sessions (explicitly excluded — ephemeral only)
- Per-record customer fields (this is per-invoice-generation, not per-row)
- Saving field templates to settings
