-- Canonical definition of a tenant schema.
-- Run with search_path already set to the target schema:
--   SET search_path TO tenant_<slug>;
-- OR prefix every table with the schema name.
-- Every new tenant gets exactly this structure.

CREATE TABLE profiles (
  id         uuid PRIMARY KEY,
  email      text NOT NULL,
  full_name  text NOT NULL DEFAULT '',
  role       text NOT NULL DEFAULT 'accountant'
               CHECK (role IN ('super_admin', 'admin', 'accountant')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  amount      numeric(12,2) NOT NULL,
  currency    text NOT NULL DEFAULT 'EUR',
  category    text NOT NULL,
  vendor      text,
  date        date NOT NULL,
  description text,
  created_by  uuid NOT NULL REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  vat_rate    numeric(5,2),
  vat_amount  numeric(12,2)
);

CREATE TABLE sales (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform     text NOT NULL,
  product_name text NOT NULL,
  product_id   uuid,
  quantity     integer NOT NULL DEFAULT 1,
  unit_price   numeric(12,2) NOT NULL,
  total_amount numeric(12,2) NOT NULL,
  currency     text NOT NULL DEFAULT 'EUR',
  date         date NOT NULL,
  description  text,
  created_by   uuid NOT NULL REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  vat_rate     numeric(5,2),
  vat_amount   numeric(12,2)
);

CREATE TABLE purchases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL,
  product_id   uuid,
  quantity     integer NOT NULL DEFAULT 1,
  unit_price   numeric(12,2) NOT NULL,
  total_amount numeric(12,2) NOT NULL,
  currency     text NOT NULL DEFAULT 'EUR',
  vendor       text,
  date         date NOT NULL,
  description  text,
  created_by   uuid NOT NULL REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  vat_rate     numeric(5,2),
  vat_amount   numeric(12,2)
);

CREATE TABLE products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  sku               text,
  current_stock     integer NOT NULL DEFAULT 0,
  reorder_threshold integer,
  created_by        uuid NOT NULL REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  user_email  text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_profile (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  logo_url   text,
  vat_number text,
  address    text,
  currency   text NOT NULL DEFAULT 'EUR',
  timezone   text NOT NULL DEFAULT 'UTC',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Stock sync: sales decrement stock when linked to a product
CREATE OR REPLACE FUNCTION update_stock_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    UPDATE products SET current_stock = current_stock - NEW.quantity
    WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_stock_change
  AFTER INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION update_stock_on_sale();

-- Stock sync: purchases increment stock when linked to a product
CREATE OR REPLACE FUNCTION update_stock_on_purchase()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    UPDATE products SET current_stock = current_stock + NEW.quantity
    WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER purchases_stock_change
  AFTER INSERT ON purchases
  FOR EACH ROW EXECUTE FUNCTION update_stock_on_purchase();
