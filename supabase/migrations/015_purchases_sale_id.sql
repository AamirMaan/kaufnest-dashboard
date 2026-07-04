-- Links a purchase to the sale that triggered it (cost of goods).
-- ON DELETE SET NULL: deleting the sale unlinks the purchase; the purchase survives.

SELECT public.run_on_all_tenant_schemas($$
  ALTER TABLE {{schema}}.purchases
    ADD COLUMN IF NOT EXISTS sale_id uuid
      REFERENCES {{schema}}.sales(id) ON DELETE SET NULL;
$$);

SELECT public.run_on_all_tenant_schemas($$
  CREATE INDEX IF NOT EXISTS idx_purchases_sale_id
    ON {{schema}}.purchases (sale_id);
$$);
