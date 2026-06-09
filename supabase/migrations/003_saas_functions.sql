-- ─── SaaS migration — Project B (Data Plane) SQL functions ──────────────────
-- Run these in the Supabase SQL editor for Project B (your existing Supabase project).
-- Phase 2 + 3 of SAAS_MIGRATION.md.

-- ─── Phase 2.3 — Stamp tenant_schema onto existing users ──────────────────────

-- Helper to write tenant_schema into a user's app_metadata (used by provisioning).
CREATE OR REPLACE FUNCTION public.set_user_tenant(
  user_id uuid,
  schema_name text
) RETURNS void AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('tenant_schema', schema_name)
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Stamp all existing users with the kaufnest schema (run once after Phase 2.2).
-- SELECT public.set_user_tenant(id, 'tenant_kaufnest') FROM auth.users;

-- ─── Phase 3.3 — set_tenant_search_path RPC ───────────────────────────────────

-- Callable by authenticated users (via server.ts) to set their session search_path.
-- Validates that schema_name starts with 'tenant_' to prevent SQL injection.
CREATE OR REPLACE FUNCTION public.set_tenant_search_path(schema_name text)
RETURNS void AS $$
BEGIN
  IF schema_name NOT LIKE 'tenant_%' THEN
    RAISE EXCEPTION 'Invalid schema name: %', schema_name;
  END IF;
  EXECUTE format('SET LOCAL search_path TO %I, public', schema_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Phase 4.2 — provision_tenant_schema function ────────────────────────────

-- Called by the provisioning API (/api/admin/provision-tenant) to create a
-- fresh tenant schema. Runs as SECURITY DEFINER with service-role credentials.
-- NOTE: Paste the full contents of supabase/tenant-schema-template.sql into the
-- body of this function, prefixing each table with %I (schema_name).
-- The recommended alternative is to use the Supabase Management API to run
-- raw SQL from your provisioning script (see SAAS_MIGRATION.md § 4.2 tip).
CREATE OR REPLACE FUNCTION public.provision_tenant_schema(schema_name text)
RETURNS void AS $$
BEGIN
  IF schema_name NOT LIKE 'tenant_%' THEN
    RAISE EXCEPTION 'Invalid schema name: %', schema_name;
  END IF;

  -- Create the schema
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

  -- Set search path and create all tables (equivalent to tenant-schema-template.sql)
  EXECUTE format('SET search_path TO %I', schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.profiles (
      id uuid PRIMARY KEY,
      email text NOT NULL,
      full_name text NOT NULL DEFAULT '',
      role text NOT NULL DEFAULT ''accountant''
        CHECK (role IN (''super_admin'', ''admin'', ''accountant'')),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.company_profile (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      logo_url text,
      vat_number text,
      address text,
      currency text NOT NULL DEFAULT ''EUR'',
      timezone text NOT NULL DEFAULT ''UTC'',
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.expenses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL,
      amount numeric(12,2) NOT NULL,
      currency text NOT NULL DEFAULT ''EUR'',
      category text NOT NULL,
      vendor text,
      date date NOT NULL,
      description text,
      created_by uuid NOT NULL REFERENCES %I.profiles(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      vat_rate numeric(5,2),
      vat_amount numeric(12,2)
    )
  $sql$, schema_name, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      sku text,
      current_stock integer NOT NULL DEFAULT 0,
      reorder_threshold integer,
      created_by uuid NOT NULL REFERENCES %I.profiles(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.sales (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      platform text NOT NULL,
      product_name text NOT NULL,
      product_id uuid REFERENCES %I.products(id) ON DELETE SET NULL,
      quantity integer NOT NULL DEFAULT 1,
      unit_price numeric(12,2) NOT NULL,
      total_amount numeric(12,2) NOT NULL,
      currency text NOT NULL DEFAULT ''EUR'',
      date date NOT NULL,
      description text,
      created_by uuid NOT NULL REFERENCES %I.profiles(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      vat_rate numeric(5,2),
      vat_amount numeric(12,2)
    )
  $sql$, schema_name, schema_name, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.purchases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_name text NOT NULL,
      product_id uuid REFERENCES %I.products(id) ON DELETE SET NULL,
      quantity integer NOT NULL DEFAULT 1,
      unit_price numeric(12,2) NOT NULL,
      total_amount numeric(12,2) NOT NULL,
      currency text NOT NULL DEFAULT ''EUR'',
      vendor text,
      date date NOT NULL,
      description text,
      created_by uuid NOT NULL REFERENCES %I.profiles(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      vat_rate numeric(5,2),
      vat_amount numeric(12,2)
    )
  $sql$, schema_name, schema_name, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I.audit_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      user_email text,
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id uuid,
      metadata jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
