import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client (singleton).
 *
 * Use for auth-only operations (sign in/out, password reset, invite
 * callbacks) — NOT for querying tenant tables, since this defaults to the
 * `public` schema. For tenant data, use `createTenantClient()` below.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * Tenant-scoped client for Client Components that read/write tenant tables
 * (sales, purchases, expenses, products, profiles, audit_logs, ...).
 *
 * `createBrowserClient` caches a singleton and ignores `db.schema` on any
 * call after the first (see node_modules/@supabase/ssr
 * dist/main/createBrowserClient.js — `if (shouldUseSingleton && cachedBrowserClient)
 * return cachedBrowserClient`), so we can't get a schema-scoped client by
 * passing `db: { schema }` like the server client does. Instead, reuse the
 * singleton's `.schema(tenantSchema)` per call (same mechanism `src/proxy.ts`
 * uses) — `.schema()` returns a lightweight PostgrestClient that still goes
 * through the singleton's authenticated fetch, so RLS/auth.uid() work as
 * expected.
 */
export async function createTenantClient() {
  const client = createClient();

  const {
    data: { session },
  } = await client.auth.getSession();

  const tenantSchema =
    (session?.user.app_metadata?.tenant_schema as string | undefined) ?? "public";

  const scoped = client.schema(tenantSchema);

  return {
    auth: client.auth,
    from: scoped.from.bind(scoped),
    rpc: scoped.rpc.bind(scoped),
  };
}

export type TenantClient = Awaited<ReturnType<typeof createTenantClient>>;
