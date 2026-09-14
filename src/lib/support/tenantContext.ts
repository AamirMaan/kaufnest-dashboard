export interface TenantContext {
  tenantId: string;
  slug: string;
  plan: string;
  schema: string;
}

export interface ControlTenantRow {
  id: string;
  slug: string | null;
  plan: string | null;
}

/** Server-only. Normalises a control.tenants row for card rendering. */
export function tenantContextFrom(row: ControlTenantRow, schema: string): TenantContext {
  return {
    tenantId: row.id,
    slug: row.slug ?? schema,
    plan: row.plan ?? "trial",
    schema,
  };
}
