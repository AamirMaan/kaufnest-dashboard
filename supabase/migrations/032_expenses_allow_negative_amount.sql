-- ============================================================
-- 032 — allow negative expenses (credit notes)
--
-- A German input-tax ledger (Vorsteuerkonto) contains credit notes alongside
-- invoices: "Erstattung von Verkäufergebühren", "Tarifas reembolsadas",
-- "Återbetalda avgifter". They are negative, and they are real money — one
-- quarter's sheet carried -218.14 net and -41.44 VAT.
--
-- `expenses_amount_check CHECK (amount >= 0)` made them unstorable, so the
-- importer had to drop them and the dashboard's totals could never reconcile
-- with the filed VAT return. Relaxing the check makes a credit note simply a
-- negative expense, and every existing SUM (totals, VAT Position, monthly
-- trend) then reconciles with no aggregate changes.
--
-- Also mirrored into provision_tenant_schema() (005) — the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.expenses
    drop constraint if exists expenses_amount_check;
$$);
