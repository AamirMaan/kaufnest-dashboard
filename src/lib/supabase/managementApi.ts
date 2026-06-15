const MANAGEMENT_API_BASE = "https://api.supabase.com/v1";

function projectRefFromUrl(url: string): string {
  const match = url.match(/^https:\/\/([^.]+)\.supabase\.co/);
  if (!match) {
    throw new Error(`Could not derive project ref from NEXT_PUBLIC_SUPABASE_URL: ${url}`);
  }
  return match[1];
}

interface PostgrestConfig {
  db_schema: string;
  [key: string]: unknown;
}

/**
 * Adds `schemaName` to Project B's PostgREST "Exposed schemas" list via the
 * Supabase Management API, so `db.schema`/`.schema()` calls against a newly
 * provisioned tenant schema don't get rejected with 404/406.
 *
 * No-op if the schema is already exposed. Requires `SUPABASE_ACCESS_TOKEN`
 * (a personal access token from supabase.com/dashboard/account/tokens) —
 * server-only, used by /api/admin/provision-tenant.
 */
export async function addExposedSchema(schemaName: string): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("SUPABASE_ACCESS_TOKEN is not set — required to expose new tenant schemas");
  }

  const ref = projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const endpoint = `${MANAGEMENT_API_BASE}/projects/${ref}/postgrest`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const getRes = await fetch(endpoint, { headers });
  if (!getRes.ok) {
    throw new Error(`Failed to read PostgREST config: ${getRes.status} ${await getRes.text()}`);
  }
  const config = (await getRes.json()) as PostgrestConfig;

  const schemas = config.db_schema.split(",").map((s) => s.trim());
  if (schemas.includes(schemaName)) {
    return;
  }

  const patchRes = await fetch(endpoint, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ db_schema: [...schemas, schemaName].join(",") }),
  });
  if (!patchRes.ok) {
    throw new Error(`Failed to update PostgREST config: ${patchRes.status} ${await patchRes.text()}`);
  }

  // PostgREST reloads its schema cache asynchronously after a config change —
  // give it a moment before the caller starts querying the new schema.
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
