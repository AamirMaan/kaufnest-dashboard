-- ============================================================
-- 042 — structured sender (ship-from) address on company_profile
--
-- Six new nullable columns, used only as the sender address for shipping
-- labels (a later feature). The existing free-text `address` column is
-- untouched and keeps doing exactly what it does today (invoice header) —
-- these are deliberately separate fields, not a migration/parse of the old
-- one, since there is no reliable way to parse a free-text address into
-- discrete street/city/state/postal/country fields automatically.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.company_profile
    ADD COLUMN IF NOT EXISTS ship_from_street1 text,
    ADD COLUMN IF NOT EXISTS ship_from_street2 text,
    ADD COLUMN IF NOT EXISTS ship_from_city text,
    ADD COLUMN IF NOT EXISTS ship_from_state text,
    ADD COLUMN IF NOT EXISTS ship_from_postal_code text,
    ADD COLUMN IF NOT EXISTS ship_from_country text;
$$);
