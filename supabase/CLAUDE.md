# Supabase SQL (`supabase/`)

SQL migrations for the two Supabase projects behind the SaaS multi-tenant
setup. **Read `SKILL.md` first** — it has the file map with apply-status, the
apply order, the index rationale, and the gotchas (PostgREST grants, exposed
schemas, JWT refresh, RLS helper functions, `CREATE INDEX CONCURRENTLY`).

## Files

- `control-plane/001_schema.sql` — Project A (`control` schema): `control.tenants`,
  `control.admin_users`, seed admin, plus the `tenant_kaufnest` registration row.
- `control-plane/002_grants.sql` — `GRANT USAGE`/table privileges on `control`
  for `service_role`, missing from 001 (`CREATE SCHEMA` grants nothing by
  default). Apply this if `createControlClient()` calls (`/admin`,
  `/api/admin/*`) fail with `42501 permission denied for schema control`.
- `control-plane/003_add_admin_email.sql` — adds nullable
  `control.tenants.admin_email`, populated by `/api/admin/provision-tenant`
  and shown in `/admin`'s tenants table.
- `migrations/001_init.sql` — Project B baseline: `public` tables, enums, RLS,
  `current_user_role()`, `handle_new_user()`, indexes.
- `migrations/002_inventory_and_vat.sql` — `public.products`, VAT columns,
  stock-sync triggers.
- `migrations/003_add_order_status.sql` — `public.sales` order `status`/`restock`
  + return-aware stock trigger.
- `migrations/004_performance_indexes.sql` — growth indexes for
  `tenant_kaufnest.sales/purchases/expenses`.
- `migrations/005_tenant_provisioning.sql` — canonical
  `public.provision_tenant_schema(schema_name)` + `public.set_user_tenant()`,
  used by Phase 4 dynamic tenant provisioning
  (`src/app/api/admin/provision-tenant/route.ts`).
- `migrations/006_bootstrap_tenant_kaufnest.sql` — historical record of how
  `tenant_kaufnest` was provisioned + seeded from `public.*`. Do not re-run.

## Related code

- `src/lib/supabase/{client,server,control}.ts` + their `SKILL.md` — the
  schema-aware Supabase clients these migrations support.
- `src/app/api/admin/provision-tenant/route.ts` — calls
  `provision_tenant_schema` via RPC for new tenants.
- `SAAS_MIGRATION.md` — the full migration narrative/checklist.
