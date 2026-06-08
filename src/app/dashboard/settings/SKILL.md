---
name: settings-feature
description: Work on the Settings dashboard feature (invoice template configuration) at src/app/dashboard/settings — use when the task mentions invoice settings, business/invoice template details, or the /dashboard/settings route.
---

# Working on the Settings feature

Read `CLAUDE.md` in this folder first. This is a thin feature: the page itself
is the only feature-private file — the invoice-settings hook and PDF generator
it uses are shared with `InvoiceModal` (used by Sales/Expenses/Purchases), so
they intentionally live in `src/lib/`, not here.

## Minimal file set for common changes

- **Add/change a settings field shown on this page**: `page.tsx` AND
  `src/lib/hooks/useInvoiceSettings.ts` (the `InvoiceSettings` type + storage),
  AND `src/lib/utils/generateInvoice.ts` if the field should appear on
  generated PDFs, AND `src/components/modals/InvoiceModal.tsx` if it reads
  that field directly.
- **Change only this page's form/layout**: `page.tsx` only.

## Test command

No test suite targets this feature yet.

## Gotchas

- Don't fork `useInvoiceSettings`/`generateInvoice` into this folder — they're
  shared with the `InvoiceModal` used across three other features. Changing
  the `InvoiceSettings` shape requires updating all three locations listed above.
