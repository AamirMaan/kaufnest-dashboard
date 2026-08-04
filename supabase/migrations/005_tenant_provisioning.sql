-- ============================================================
-- Tenant schema provisioning (Project B — Data Plane)
--
-- Status: ✅ Applied to Project B. tenant_kaufnest itself is already
-- provisioned (see 006_bootstrap_tenant_kaufnest.sql) — running this file did
-- NOT touch it. This file (re)defines public.set_user_tenant and
-- public.provision_tenant_schema, the two functions Phase 4's dynamic
-- provisioning (src/app/api/admin/provision-tenant/route.ts) calls for every
-- NEW tenant. Re-running it (e.g. after editing the function bodies below) is
-- safe — see the idempotency note further down — and
-- provision_tenant_schema(schema_name) itself can also be safely retried for
-- the same schema_name after a partial failure.
--
-- This is the CANONICAL definition of a tenant schema (tenant_<slug>).
-- It replaces the old 003_saas_functions.sql, supabase/tenant-schema-template.sql,
-- the table/RLS/trigger/index definitions from 004_phase2_tenant_kaufnest.sql,
-- the grants from 005_grant_tenant_kaufnest_privileges.sql, and the
-- tenant_kaufnest portion of the old 007_add_order_status.sql (status/restock
-- columns + return-aware stock trigger are now part of the table/trigger
-- definitions below from the start — no separate ALTER step needed for new
-- tenants).
--
-- Any future change to sales/purchases/expenses/products/etc. that should
-- apply to ALL tenants (existing and future) must be made here. See
-- supabase/SKILL.md for the "3 places" rule covering public (if still live)
-- + this function + 006_bootstrap_tenant_kaufnest.sql's data migration.
--
-- Idempotency: CREATE TABLE/INDEX use IF NOT EXISTS, functions use
-- CREATE OR REPLACE, and triggers use CREATE OR REPLACE TRIGGER (PG14+) — so
-- re-running this file is safe. provision_tenant_schema() itself is also
-- safely re-runnable for the same schema_name: section 5 drops any existing
-- policies on that schema (via pg_policies) before recreating them, since
-- CREATE POLICY has no IF NOT EXISTS/OR REPLACE — without this, retrying
-- after a partial failure (e.g. the provisioning API errored at the
-- invite/exposed-schema step) hits "policy ... already exists".
--
-- set_tenant_search_path (from the old 003_saas_functions.sql) has been
-- removed — it was unused by app code (src/lib/supabase/server.ts uses the
-- `db: { schema }` client option instead, see src/lib/supabase/SKILL.md).
-- ============================================================

create extension if not exists pgcrypto;

-- ─── set_user_tenant ────────────────────────────────────────
-- Writes tenant_schema into a user's app_metadata (used by provisioning and
-- by 006_bootstrap_tenant_kaufnest.sql to stamp existing users).
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

-- ─── provision_tenant_schema ────────────────────────────────
-- Called by /api/admin/provision-tenant (RPC: provision_tenant_schema(schema_name)).
-- Creates a complete tenant_<slug> schema: tables, triggers, RLS, indexes, grants.
CREATE OR REPLACE FUNCTION public.provision_tenant_schema(schema_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tbl text;
  pol record;
BEGIN
  IF schema_name NOT LIKE 'tenant_%' THEN
    RAISE EXCEPTION 'Invalid schema name: %', schema_name;
  END IF;

  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

  -- ── 1. Tables (order matters for FK constraints) ──────────

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.profiles (
      id         uuid PRIMARY KEY,
      email      text NOT NULL,
      full_name  text NOT NULL DEFAULT '',
      role       text NOT NULL DEFAULT 'accountant'
                   CHECK (role IN ('super_admin', 'admin', 'accountant')),
      permission_overrides jsonb NOT NULL DEFAULT '[]'::jsonb,
      status     text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'deactivated')),
      notifications_read_through timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.products (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name              text NOT NULL UNIQUE,
      sku               text,
      current_stock     integer NOT NULL DEFAULT 0,
      reorder_threshold integer,
      created_by        uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.expenses (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title       text NOT NULL,
      amount      numeric(12,2) NOT NULL CHECK (amount >= 0),
      currency    text NOT NULL DEFAULT 'EUR',
      category    text NOT NULL,
      vendor      text,
      date        date NOT NULL,
      description text,
      created_by  uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      vat_rate          numeric(5,2),
      vat_amount        numeric(12,2),
      vendor_vat_number text,
      invoice_number    text
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.sales (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      platform     text NOT NULL,
      product_name text NOT NULL,
      product_id   uuid REFERENCES %1$I.products(id) ON DELETE SET NULL,
      quantity     integer NOT NULL CHECK (quantity > 0),
      unit_price   numeric(12,2) NOT NULL CHECK (unit_price >= 0),
      total_amount numeric(12,2) NOT NULL,
      currency     text NOT NULL DEFAULT 'EUR',
      date         date NOT NULL,
      description  text,
      created_by   uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      vat_rate     numeric(5,2),
      vat_amount   numeric(12,2),
      status       text NOT NULL DEFAULT 'pending',
      restock      boolean NOT NULL DEFAULT false,
      external_order_id text
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.purchases (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_name text NOT NULL,
      product_id   uuid REFERENCES %1$I.products(id) ON DELETE SET NULL,
      quantity     integer NOT NULL CHECK (quantity > 0),
      unit_price   numeric(12,2) NOT NULL CHECK (unit_price >= 0),
      total_amount numeric(12,2) NOT NULL,
      currency     text NOT NULL DEFAULT 'EUR',
      vendor       text,
      date         date NOT NULL,
      description  text,
      created_by   uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      vat_rate     numeric(5,2),
      vat_amount   numeric(12,2)
    )
  $sql$, schema_name);

  EXECUTE format(
    'ALTER TABLE %1$I.purchases ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES %1$I.sales(id) ON DELETE SET NULL',
    schema_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_purchases_sale_id ON %1$I.purchases (sale_id)',
    schema_name
  );
  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_sale_id_unique ON %1$I.purchases (sale_id) WHERE sale_id IS NOT NULL',
    schema_name
  );

  -- NOTE: user_id is nullable here to match audit_logs' `on delete set null`
  -- pattern used elsewhere (a deleted user shouldn't break their audit trail).
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.audit_logs (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     uuid,
      user_email  text,
      action      text NOT NULL,
      entity_type text NOT NULL,
      entity_id   uuid,
      metadata    jsonb,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  -- notifications: one row per EVENT, not per user. Visibility is a property
  -- of the row and is resolved per-reader by RLS (see section 5) — the
  -- client needs no permission logic at all. Rows are written ONLY by the
  -- SECURITY DEFINER triggers added near the end of this function; there is
  -- deliberately no insert/update/delete grant/policy for authenticated/anon
  -- (see the explicit REVOKE after section 7).
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.notifications (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type                text NOT NULL,
      category            text NOT NULL,
      entity_type         text,
      entity_id           uuid,
      title               text NOT NULL,
      body                text,
      link                text,
      payload             jsonb,
      actor_id            uuid,
      visible_to_roles    text[] NOT NULL,
      required_permission text,
      created_at          timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.notification_reads (
      notification_id uuid NOT NULL REFERENCES %1$I.notifications(id) ON DELETE CASCADE,
      user_id         uuid NOT NULL REFERENCES %1$I.profiles(id)      ON DELETE CASCADE,
      read_at         timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (notification_id, user_id)
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.company_profile (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name           text NOT NULL,
      logo_url       text,
      vat_number     text,
      tax_id         text,
      address        text,
      phone          text,
      email          text,
      currency       text NOT NULL DEFAULT 'EUR',
      timezone       text NOT NULL DEFAULT 'UTC',
      vat_rate       numeric NOT NULL DEFAULT 19,
      bank_name      text,
      iban           text,
      bic            text,
      invoice_prefix text NOT NULL DEFAULT 'INV-',
      payment_terms  text NOT NULL DEFAULT '30 days',
      footer_notes   text,
      updated_at     timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  -- platform_connections: one row per platform (ebay/amazon) holding OAuth
  -- tokens for the tenant's connected seller account. Tokens are sensitive —
  -- see section 5 below, RLS restricts ALL operations (incl. SELECT) to
  -- admin/super_admin, unlike company_profile which allows SELECT for any
  -- tenant member.
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.platform_connections (
      id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      platform             text NOT NULL CHECK (platform IN ('ebay', 'amazon')),
      status               text NOT NULL DEFAULT 'disconnected'
                             CHECK (status IN ('connected', 'disconnected', 'error')),
      access_token         text,
      refresh_token        text,
      token_expires_at     timestamptz,
      external_account_id  text,
      marketplace_id       text,
      last_synced_at       timestamptz,
      last_sync_status     text,
      last_sync_error      text,
      connected_by         uuid REFERENCES %1$I.profiles(id),
      created_at           timestamptz NOT NULL DEFAULT now(),
      updated_at           timestamptz NOT NULL DEFAULT now(),
      UNIQUE (platform)
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.platform_payouts (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      platform     TEXT NOT NULL CHECK (platform IN ('ebay', 'amazon')),
      amount       NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      currency     TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR', 'USD', 'GBP')),
      date         DATE NOT NULL,
      notes        TEXT,
      created_by   UUID REFERENCES %1$I.profiles(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.ebay_listing_drafts (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_type            text NOT NULL CHECK (source_type IN ('inventory', 'dropship')),
      product_id             uuid REFERENCES %1$I.products(id),
      source_url             text,
      source_platform        text,
      title                  text NOT NULL,
      description            text,
      price                  numeric(12,2) NOT NULL CHECK (price >= 0),
      currency               text NOT NULL DEFAULT 'EUR',
      quantity               integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
      condition              text NOT NULL CHECK (condition IN ('new', 'used', 'refurbished')),
      category_id            text,
      category_name          text,
      image_urls             text[] NOT NULL DEFAULT '{}',
      fulfillment_policy_id  text,
      payment_policy_id      text,
      return_policy_id       text,
      ebay_sku               text,
      status                 text NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'publishing', 'published', 'failed')),
      ebay_offer_id          text,
      ebay_listing_id        text,
      publish_error          text,
      created_by             uuid NOT NULL REFERENCES %1$I.profiles(id),
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.ebay_messages (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      external_message_id   text,
      item_id                text NOT NULL,
      buyer_username         text NOT NULL,
      direction              text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      subject                text,
      body                   text NOT NULL,
      question_type          text,
      is_read                boolean NOT NULL DEFAULT false,
      ebay_created_at        timestamptz NOT NULL,
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now()
    )
  $sql$, schema_name);

  -- ── 2. updated_at triggers (reuse schema-agnostic public.set_updated_at) ──

  EXECUTE format('CREATE OR REPLACE TRIGGER set_expenses_updated_at BEFORE UPDATE ON %1$I.expenses FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', schema_name);
  EXECUTE format('CREATE OR REPLACE TRIGGER set_purchases_updated_at BEFORE UPDATE ON %1$I.purchases FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', schema_name);
  EXECUTE format('CREATE OR REPLACE TRIGGER set_sales_updated_at BEFORE UPDATE ON %1$I.sales FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', schema_name);
  EXECUTE format('CREATE OR REPLACE TRIGGER set_products_updated_at BEFORE UPDATE ON %1$I.products FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', schema_name);
  EXECUTE format('CREATE OR REPLACE TRIGGER set_platform_connections_updated_at BEFORE UPDATE ON %1$I.platform_connections FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', schema_name);
  EXECUTE format('CREATE OR REPLACE TRIGGER set_ebay_listing_drafts_updated_at BEFORE UPDATE ON %1$I.ebay_listing_drafts FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', schema_name);
  EXECUTE format('CREATE OR REPLACE TRIGGER set_ebay_messages_updated_at BEFORE UPDATE ON %1$I.ebay_messages FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at()', schema_name);

  -- ── 3. Tenant-membership + role helper functions ──────────
  -- is_tenant_member(): caller's JWT app_metadata.tenant_schema must equal
  -- this schema. Closes the gap left by provision_tenant_schema's own
  -- 'tenant_%' prefix check — without this, an authenticated user from a
  -- *different* tenant could read this schema's tables via
  -- `db: { schema: schema_name }` directly.

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.is_tenant_member()
    RETURNS boolean
    LANGUAGE sql STABLE
    AS $func$
      SELECT COALESCE(
        (auth.jwt() -> 'app_metadata' ->> 'tenant_schema') = %1$L,
        false
      );
    $func$;
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.current_user_role()
    RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
      SELECT role FROM profiles WHERE id = auth.uid();
    $func$;
  $sql$, schema_name);

  -- current_user_has_override(perm): true when `perm` (a Permission key from
  -- src/lib/utils/permissions.ts) is present in the caller's additive
  -- permission_overrides array. Used by the delete policies below to grant
  -- e.g. delete_sale to a non-admin/super_admin user without changing their
  -- role — see 023_user_permission_overrides.sql.
  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.current_user_has_override(perm text)
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
      SELECT COALESCE(
        (SELECT permission_overrides FROM profiles WHERE id = auth.uid()) ? perm,
        false
      );
    $func$;
  $sql$, schema_name);

  -- ── 4. Stock-sync triggers ─────────────────────────────────
  -- Same INSERT/UPDATE/DELETE-aware logic as the public schema
  -- (002_inventory_and_vat.sql / 003_add_order_status.sql): each function
  -- reverses the OLD row's stock effect and applies the NEW row's effect,
  -- handling inserts, quantity edits, re-linking to a different product, and
  -- deletes in a single code path. Sales already account for the
  -- returned+restock case from the start (delta = 0 when
  -- status = 'returned' AND restock, else -quantity).

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.apply_purchase_stock_change()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    BEGIN
      IF (TG_OP = 'INSERT') THEN
        IF NEW.product_id IS NOT NULL THEN
          UPDATE products SET current_stock = current_stock + NEW.quantity
            WHERE id = NEW.product_id;
        END IF;
        RETURN NEW;
      ELSIF (TG_OP = 'UPDATE') THEN
        IF OLD.product_id IS NOT NULL THEN
          UPDATE products SET current_stock = current_stock - OLD.quantity
            WHERE id = OLD.product_id;
        END IF;
        IF NEW.product_id IS NOT NULL THEN
          UPDATE products SET current_stock = current_stock + NEW.quantity
            WHERE id = NEW.product_id;
        END IF;
        RETURN NEW;
      ELSIF (TG_OP = 'DELETE') THEN
        IF OLD.product_id IS NOT NULL THEN
          UPDATE products SET current_stock = current_stock - OLD.quantity
            WHERE id = OLD.product_id;
        END IF;
        RETURN OLD;
      END IF;
      RETURN NULL;
    END;
    $func$;
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.apply_sale_stock_change()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I
    AS $func$
    DECLARE
      old_delta integer;
      new_delta integer;
    BEGIN
      IF (TG_OP = 'INSERT') THEN
        IF NEW.product_id IS NOT NULL THEN
          new_delta := CASE WHEN NEW.status = 'returned' AND NEW.restock THEN 0 ELSE -NEW.quantity END;
          UPDATE products SET current_stock = current_stock + new_delta
            WHERE id = NEW.product_id;
        END IF;
        RETURN NEW;
      ELSIF (TG_OP = 'UPDATE') THEN
        IF OLD.product_id IS NOT NULL THEN
          old_delta := CASE WHEN OLD.status = 'returned' AND OLD.restock THEN 0 ELSE -OLD.quantity END;
          UPDATE products SET current_stock = current_stock - old_delta
            WHERE id = OLD.product_id;
        END IF;
        IF NEW.product_id IS NOT NULL THEN
          new_delta := CASE WHEN NEW.status = 'returned' AND NEW.restock THEN 0 ELSE -NEW.quantity END;
          UPDATE products SET current_stock = current_stock + new_delta
            WHERE id = NEW.product_id;
        END IF;
        RETURN NEW;
      ELSIF (TG_OP = 'DELETE') THEN
        IF OLD.product_id IS NOT NULL THEN
          old_delta := CASE WHEN OLD.status = 'returned' AND OLD.restock THEN 0 ELSE -OLD.quantity END;
          UPDATE products SET current_stock = current_stock - old_delta
            WHERE id = OLD.product_id;
        END IF;
        RETURN OLD;
      END IF;
      RETURN NULL;
    END;
    $func$;
  $sql$, schema_name);

  EXECUTE format('CREATE OR REPLACE TRIGGER purchases_stock_change AFTER INSERT OR UPDATE OR DELETE ON %1$I.purchases FOR EACH ROW EXECUTE PROCEDURE %1$I.apply_purchase_stock_change()', schema_name);
  EXECUTE format('CREATE OR REPLACE TRIGGER sales_stock_change AFTER INSERT OR UPDATE OR DELETE ON %1$I.sales FOR EACH ROW EXECUTE PROCEDURE %1$I.apply_sale_stock_change()', schema_name);

  -- ── 5. Row-Level Security ──────────────────────────────────

  FOREACH tbl IN ARRAY ARRAY['profiles', 'expenses', 'purchases', 'sales', 'products', 'audit_logs', 'company_profile', 'platform_connections', 'platform_payouts', 'ebay_listing_drafts', 'ebay_messages', 'notifications', 'notification_reads']
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', schema_name, tbl);
  END LOOP;

  -- Drop any policies left over from a previous failed/partial provisioning
  -- attempt at this schema_name — CREATE POLICY has no IF NOT EXISTS/OR
  -- REPLACE, so without this a retry errors with "policy ... already exists".
  FOR pol IN
    SELECT policyname, tablename FROM pg_policies WHERE schemaname = schema_name
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', pol.policyname, schema_name, pol.tablename);
  END LOOP;

  -- profiles
  EXECUTE format('CREATE POLICY "profiles_select_self" ON %1$I.profiles FOR SELECT USING (%1$I.is_tenant_member() AND id = auth.uid())', schema_name);
  EXECUTE format('CREATE POLICY "profiles_select_admin" ON %1$I.profiles FOR SELECT USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);
  EXECUTE format('CREATE POLICY "profiles_update_self" ON %1$I.profiles FOR UPDATE USING (%1$I.is_tenant_member() AND id = auth.uid()) WITH CHECK (%1$I.is_tenant_member() AND id = auth.uid())', schema_name);
  EXECUTE format('CREATE POLICY "profiles_manage_super_admin" ON %1$I.profiles FOR ALL USING (%1$I.is_tenant_member() AND %1$I.current_user_role() = ''super_admin'')', schema_name);

  -- expenses
  EXECUTE format('CREATE POLICY "expenses_select" ON %1$I.expenses FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "expenses_insert" ON %1$I.expenses FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "expenses_update" ON %1$I.expenses FOR UPDATE USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "expenses_delete" ON %1$I.expenses FOR DELETE USING (%1$I.is_tenant_member() AND (%1$I.current_user_role() IN (''admin'', ''super_admin'') OR %1$I.current_user_has_override(''delete_expense'')))', schema_name);

  -- purchases
  EXECUTE format('CREATE POLICY "purchases_select" ON %1$I.purchases FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "purchases_insert" ON %1$I.purchases FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "purchases_update" ON %1$I.purchases FOR UPDATE USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "purchases_delete" ON %1$I.purchases FOR DELETE USING (%1$I.is_tenant_member() AND (%1$I.current_user_role() IN (''admin'', ''super_admin'') OR %1$I.current_user_has_override(''delete_purchase'')))', schema_name);

  -- sales
  EXECUTE format('CREATE POLICY "sales_select" ON %1$I.sales FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "sales_insert" ON %1$I.sales FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "sales_update" ON %1$I.sales FOR UPDATE USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "sales_delete" ON %1$I.sales FOR DELETE USING (%1$I.is_tenant_member() AND (%1$I.current_user_role() IN (''admin'', ''super_admin'') OR %1$I.current_user_has_override(''delete_sale'')))', schema_name);

  -- products
  EXECUTE format('CREATE POLICY "products_select" ON %1$I.products FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "products_insert" ON %1$I.products FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "products_update" ON %1$I.products FOR UPDATE USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "products_delete" ON %1$I.products FOR DELETE USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);

  -- audit_logs
  EXECUTE format('CREATE POLICY "audit_logs_select" ON %1$I.audit_logs FOR SELECT USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);
  EXECUTE format('CREATE POLICY "audit_logs_insert" ON %1$I.audit_logs FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);

  -- company_profile
  EXECUTE format('CREATE POLICY "company_profile_select" ON %1$I.company_profile FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "company_profile_update" ON %1$I.company_profile FOR UPDATE USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);
  EXECUTE format('CREATE POLICY "company_profile_insert" ON %1$I.company_profile FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);

  -- platform_connections — contains OAuth tokens, admin/super_admin only for
  -- every operation including SELECT.
  EXECUTE format('CREATE POLICY "platform_connections_all_admin" ON %1$I.platform_connections FOR ALL USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin'')) WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);

  -- platform_payouts — all authenticated tenant members can read; write restricted to admin/super_admin
  EXECUTE format('CREATE POLICY "platform_payouts_select" ON %1$I.platform_payouts FOR SELECT USING (%1$I.is_tenant_member() AND auth.role() = ''authenticated'')', schema_name);
  EXECUTE format('CREATE POLICY "platform_payouts_insert" ON %1$I.platform_payouts FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);
  EXECUTE format('CREATE POLICY "platform_payouts_delete" ON %1$I.platform_payouts FOR DELETE USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);

  -- ebay_listing_drafts — admin/super_admin only, all operations (mirrors platform_connections)
  EXECUTE format('CREATE POLICY "ebay_listing_drafts_all_admin" ON %1$I.ebay_listing_drafts FOR ALL USING (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin'')) WITH CHECK (%1$I.is_tenant_member() AND %1$I.current_user_role() IN (''admin'', ''super_admin''))', schema_name);

  -- ebay_messages — admin/super_admin, or a user granted the manage_messages
  -- override (030 — without this branch, a user granted the override can see
  -- the message.received notification (029) but not the row it points to).
  EXECUTE format('CREATE POLICY "ebay_messages_all_admin" ON %1$I.ebay_messages FOR ALL USING (%1$I.is_tenant_member() AND (%1$I.current_user_role() IN (''admin'', ''super_admin'') OR %1$I.current_user_has_override(''manage_messages''))) WITH CHECK (%1$I.is_tenant_member() AND (%1$I.current_user_role() IN (''admin'', ''super_admin'') OR %1$I.current_user_has_override(''manage_messages'')))', schema_name);

  -- notifications — read-only: tenant members see rows their role allows,
  -- plus rows unlocked by an additive per-user permission override. There is
  -- deliberately no insert/update/delete policy — only the SECURITY DEFINER
  -- triggers write here.
  EXECUTE format('CREATE POLICY "notifications_select" ON %1$I.notifications FOR SELECT USING (%1$I.is_tenant_member() AND (%1$I.current_user_role() = ANY(visible_to_roles) OR (required_permission IS NOT NULL AND %1$I.current_user_has_override(required_permission))))', schema_name);

  -- notification_reads — each user manages only their own read receipts.
  EXECUTE format('CREATE POLICY "notification_reads_select" ON %1$I.notification_reads FOR SELECT USING (%1$I.is_tenant_member() AND user_id = auth.uid())', schema_name);
  EXECUTE format('CREATE POLICY "notification_reads_insert" ON %1$I.notification_reads FOR INSERT WITH CHECK (%1$I.is_tenant_member() AND user_id = auth.uid())', schema_name);
  EXECUTE format('CREATE POLICY "notification_reads_delete" ON %1$I.notification_reads FOR DELETE USING (%1$I.is_tenant_member() AND user_id = auth.uid())', schema_name);

  -- ── 6. Indexes ──────────────────────────────────────────────
  -- Same set as public (see 002_inventory_and_vat.sql, 003_add_order_status.sql,
  -- 004_performance_indexes.sql) — every tenant gets the growth-oriented
  -- created_by/category/vendor/(date,status)/(date,category) indexes from
  -- the start. Index names only need to be unique within their own schema,
  -- so no per-tenant prefix is needed.

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_expenses_date ON %1$I.expenses (date DESC)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON %1$I.expenses (created_by)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_expenses_category ON %1$I.expenses (category)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_expenses_date_category ON %1$I.expenses (date DESC, category)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_purchases_date ON %1$I.purchases (date DESC)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_purchases_product ON %1$I.purchases (product_id)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_purchases_created_by ON %1$I.purchases (created_by)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_purchases_vendor ON %1$I.purchases (vendor)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_date ON %1$I.sales (date DESC)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_platform ON %1$I.sales (platform)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_product ON %1$I.sales (product_id)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_status ON %1$I.sales (status)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_created_by ON %1$I.sales (created_by)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_sales_date_status ON %1$I.sales (date DESC, status)', schema_name);

  -- Non-partial unique index: Postgres treats multiple NULLs as distinct, so
  -- manually-created/imported sales (external_order_id IS NULL) are
  -- unaffected, while platform-synced rows can be upserted idempotently via
  -- .upsert(rows, { onConflict: "platform,external_order_id" }).
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_platform_external_order_id ON %1$I.sales (platform, external_order_id)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_products_name ON %1$I.products (name)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON %1$I.audit_logs (user_id)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON %1$I.audit_logs (entity_type, entity_id)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON %1$I.audit_logs (created_at DESC)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_platform_payouts_platform_date ON %1$I.platform_payouts (platform, date)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_ebay_listing_drafts_status ON %1$I.ebay_listing_drafts (status)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_ebay_listing_drafts_created_by ON %1$I.ebay_listing_drafts (created_by)', schema_name);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS idx_ebay_messages_external_id ON %1$I.ebay_messages (external_message_id) WHERE external_message_id IS NOT NULL', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_ebay_messages_thread ON %1$I.ebay_messages (buyer_username, item_id, ebay_created_at)', schema_name);

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_notifications_created ON %1$I.notifications (created_at DESC)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_notifications_category ON %1$I.notifications (category)', schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON %1$I.notification_reads (user_id)', schema_name);

  -- ── 7. Grants ───────────────────────────────────────────────
  -- create schema does NOT grant anything by default — without this every
  -- PostgREST request against the new schema fails with "permission denied
  -- for schema ..." (42501) before RLS is even evaluated.

  EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated, service_role', schema_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO anon, authenticated, service_role', schema_name);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO anon, authenticated, service_role', schema_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role', schema_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role', schema_name);

  -- notifications privileges: the blanket "ALL TABLES" grant above (and the
  -- ALTER DEFAULT PRIVILEGES it sets for future tables) would otherwise leave
  -- insert/update/delete on notifications open to anon/authenticated. This
  -- must run AFTER the blanket grant so the REVOKE below actually sticks —
  -- RLS alone is insufficient; privileges must match intent. Mirrors
  -- 028_notifications.sql exactly.
  EXECUTE format('GRANT SELECT ON %1$I.notifications TO authenticated', schema_name);
  EXECUTE format('GRANT SELECT, INSERT, DELETE ON %1$I.notification_reads TO authenticated', schema_name);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %1$I.notifications FROM authenticated, anon', schema_name);

  -- ── 8. Notification triggers ───────────────────────────────
  -- Three SECURITY DEFINER triggers (sale/purchase/message created). No
  -- low-stock trigger — low stock is a READ-TIME state evaluated by the
  -- client, not a stored event (see 029_notification_triggers.sql header for
  -- why a stored crossing trigger double-fires on sale edits). search_path is
  -- pinned on every function, and each insert is exception-wrapped so a
  -- notification failure can never abort the parent sale/purchase/message
  -- write. Mirrors 029_notification_triggers.sql exactly.

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.notify_sale_created()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I, public
    AS $func$
    BEGIN
      BEGIN
        INSERT INTO %1$I.notifications
          (type, category, entity_type, entity_id, title, body, link, payload, actor_id, visible_to_roles, required_permission)
        VALUES ('sale.created', 'orders', 'sale', NEW.id,
          'New order: ' || NEW.product_name,
          NEW.quantity || ' × ' || NEW.product_name || ' — ' || NEW.total_amount || ' ' || NEW.currency,
          '/dashboard/sales/' || NEW.id,
          jsonb_build_object('platform', NEW.platform, 'quantity', NEW.quantity,
                             'total_amount', NEW.total_amount, 'currency', NEW.currency),
          NEW.created_by, ARRAY['super_admin','admin','accountant'], NULL);
      EXCEPTION
        WHEN OTHERS THEN
          NULL; -- notifications must never block a core write
      END;
      RETURN NEW;
    END;
    $func$;
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.notify_purchase_created()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I, public
    AS $func$
    BEGIN
      BEGIN
        INSERT INTO %1$I.notifications
          (type, category, entity_type, entity_id, title, body, link, payload, actor_id, visible_to_roles, required_permission)
        VALUES ('purchase.created', 'purchases', 'purchase', NEW.id,
          'New purchase: ' || NEW.product_name,
          NEW.quantity || ' × ' || NEW.product_name || ' — ' || NEW.total_amount || ' ' || NEW.currency,
          '/dashboard/purchases',
          jsonb_build_object('quantity', NEW.quantity, 'total_amount', NEW.total_amount,
                             'currency', NEW.currency, 'vendor', NEW.vendor),
          NEW.created_by, ARRAY['super_admin','admin','accountant'], NULL);
      EXCEPTION
        WHEN OTHERS THEN
          NULL; -- notifications must never block a core write
      END;
      RETURN NEW;
    END;
    $func$;
  $sql$, schema_name);

  EXECUTE format($sql$
    CREATE OR REPLACE FUNCTION %1$I.notify_message_received()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = %1$I, public
    AS $func$
    BEGIN
      IF NEW.direction = 'inbound' THEN
        BEGIN
          INSERT INTO %1$I.notifications
            (type, category, entity_type, entity_id, title, body, link, payload, actor_id, visible_to_roles, required_permission)
          VALUES ('message.received', 'messages', 'message', NEW.id,
            'New message from ' || NEW.buyer_username,
            coalesce(NEW.subject, left(NEW.body, 120)),
            '/dashboard/messages',
            jsonb_build_object('buyer_username', NEW.buyer_username, 'item_id', NEW.item_id,
                               'subject', NEW.subject),
            NULL, ARRAY['super_admin','admin'], 'manage_messages');
        EXCEPTION
          WHEN OTHERS THEN
            NULL; -- notifications must never block a core write
        END;
      END IF;
      RETURN NEW;
    END;
    $func$;
  $sql$, schema_name);

  EXECUTE format('DROP TRIGGER IF EXISTS notify_sale_created ON %1$I.sales', schema_name);
  EXECUTE format('CREATE TRIGGER notify_sale_created AFTER INSERT ON %1$I.sales FOR EACH ROW EXECUTE FUNCTION %1$I.notify_sale_created()', schema_name);

  EXECUTE format('DROP TRIGGER IF EXISTS notify_purchase_created ON %1$I.purchases', schema_name);
  EXECUTE format('CREATE TRIGGER notify_purchase_created AFTER INSERT ON %1$I.purchases FOR EACH ROW EXECUTE FUNCTION %1$I.notify_purchase_created()', schema_name);

  EXECUTE format('DROP TRIGGER IF EXISTS notify_message_received ON %1$I.ebay_messages', schema_name);
  EXECUTE format('CREATE TRIGGER notify_message_received AFTER INSERT ON %1$I.ebay_messages FOR EACH ROW EXECUTE FUNCTION %1$I.notify_message_received()', schema_name);

END;
$$;
