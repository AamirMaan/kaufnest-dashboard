import { createServerClient } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Browser-session-aware server client, scoped to the user's tenant schema.
 *
 * PostgREST routes a request to a schema via the Accept-Profile /
 * Content-Profile headers (the `db.schema` client option), fixed when the
 * client is constructed. `SET LOCAL search_path` via an RPC call does NOT
 * work for this: supabase-js issues a separate HTTP request (and Postgres
 * transaction) per .from()/.rpc() call, so a search_path set during one
 * request has no effect on the next. We therefore resolve the tenant schema
 * first with a public-schema client, then build the real client with
 * `db.schema` set.
 *
 * The resolved schema must be listed in the project's "Exposed schemas" API
 * setting (Project Settings -> API -> Data API Settings) or PostgREST
 * rejects it.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component — middleware handles cookie refresh
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await authClient.auth.getUser();

  const tenantSchema = user?.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return authClient;
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component — middleware handles cookie refresh
          }
        },
      },
      db: { schema: tenantSchema },
    }
  );
}

/**
 * Service-role client scoped to a specific tenant schema via the `db.schema`
 * option (see createClient for why SET search_path / RPC doesn't work here).
 * Use in server-side provisioning and admin operations only — never client-side.
 */
export function createServiceClientForTenant(schemaName: string) {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: schemaName } }
  );
}
