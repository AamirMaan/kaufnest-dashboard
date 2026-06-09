import { createServerClient } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Browser-session-aware server client.
 * After Phase 3 of SAAS_MIGRATION.md is applied, reads tenant_schema from the
 * user's JWT app_metadata and calls set_tenant_search_path so every query
 * automatically hits the correct tenant schema. Falls back to the public schema
 * if the RPC is not yet deployed (Phases 1–2 in progress).
 */
export async function createClient() {
  const cookieStore = await cookies();

  const client = createServerClient(
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

  // Set tenant search_path so all subsequent queries hit the right schema.
  // Wrapped in try/catch — the RPC doesn't exist until Phase 3 DB migration is
  // applied, so the app falls back gracefully to the public schema until then.
  const {
    data: { user },
  } = await client.auth.getUser();

  const tenantSchema = user?.app_metadata?.tenant_schema as string | undefined;
  if (tenantSchema) {
    try {
      await client.rpc("set_tenant_search_path", { schema_name: tenantSchema });
    } catch {
      // Phase 3 not yet applied — queries fall back to public schema
    }
  }

  return client;
}

/**
 * Service-role client for a specific tenant schema.
 * Use in server-side provisioning and admin operations only — never client-side.
 */
export function createServiceClientForTenant(_schemaName: string) {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}
