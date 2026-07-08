-- ============================================================
-- Expense vendor VAT number + invoice number — all tenant schemas
--
-- Adds two optional text columns to the expenses table:
--   vendor_vat_number — the vendor's VAT ID (e.g. DE123456789)
--   invoice_number    — the vendor's invoice reference number
--
-- Uses run_on_all_tenant_schemas so all live tenants receive the
-- columns in one shot. Also baked into provision_tenant_schema()
-- in 005_tenant_provisioning.sql for new tenants (2-places rule).
--
-- Idempotent: ADD COLUMN uses IF NOT EXISTS.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.expenses
    ADD COLUMN IF NOT EXISTS vendor_vat_number text,
    ADD COLUMN IF NOT EXISTS invoice_number    text;
$$);
