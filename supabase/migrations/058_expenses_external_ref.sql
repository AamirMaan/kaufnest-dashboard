-- supabase/migrations/058_expenses_external_ref.sql
-- ============================================================
-- 058 — expenses.external_ref + expenses.connection_id
-- Design: docs/superpowers/specs/2026-10-21-ebay-finances-fees-design.md
--
-- external_ref: dedup key for expenses imported from a platform API
-- ('ebay:<transactionId>'). FULL (non-partial) unique index on purpose —
-- Supabase .upsert({ onConflict }) cannot target a partial index (033).
-- NULLs never conflict, so manual expenses are unaffected.
-- connection_id: which platform_connections account a charge came from
-- (same shape as sales.connection_id, 056).
-- No category change: expenses.category is plain text with no CHECK on
-- every live tenant (checked 2026-10-21); 'platform_fees' is TS/UI only.
-- Mirrored into provision_tenant_schema() (005).
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.expenses
    ADD COLUMN IF NOT EXISTS external_ref text,
    ADD COLUMN IF NOT EXISTS connection_id uuid
      REFERENCES {{schema}}.platform_connections(id) ON DELETE SET NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_external_ref
    ON {{schema}}.expenses (external_ref);
$$);
