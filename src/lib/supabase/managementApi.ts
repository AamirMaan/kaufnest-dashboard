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

const EXPOSE_MAX_ATTEMPTS = 4;
const POSTGREST_RELOAD_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readExposedSchemas(endpoint: string, headers: Record<string, string>): Promise<string[]> {
  const getRes = await fetch(endpoint, { headers });
  if (!getRes.ok) {
    throw new Error(`Failed to read PostgREST config: ${getRes.status} ${await getRes.text()}`);
  }
  const config = (await getRes.json()) as PostgrestConfig;
  return config.db_schema.split(",").map((s) => s.trim());
}

/**
 * Adds `schemaName` to Project B's PostgREST "Exposed schemas" list via the
 * Supabase Management API, so `db.schema`/`.schema()` calls against a newly
 * provisioned tenant schema don't get rejected with 404/406.
 *
 * No-op if the schema is already exposed. Requires `SUPABASE_ACCESS_TOKEN`
 * (a personal access token from supabase.com/dashboard/account/tokens) —
 * server-only.
 *
 * This is a read-modify-write on a SINGLE GLOBAL config string shared by
 * every tenant, so two concurrent provisions can lose one another's update:
 * both read the same list, both append their own schema, and the second PATCH
 * overwrites the first. The loser's schema is silently never exposed and
 * their entire app returns 404/406 with no error logged anywhere.
 *
 * Rather than assume the PATCH stuck, this re-reads the config and retries
 * until it can see its own schema in the list. That converges under
 * concurrency because every attempt re-reads the current value. Self-serve
 * signup (2026-08-28) made concurrent provisions realistic; the same race was
 * always present in admin provisioning, just far less likely to fire.
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

  for (let attempt = 1; attempt <= EXPOSE_MAX_ATTEMPTS; attempt++) {
    const schemas = await readExposedSchemas(endpoint, headers);

    // Verified present — either it already was, or our previous attempt's
    // PATCH survived. Safe to return.
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

    // PostgREST reloads its schema cache asynchronously after a config
    // change. This also gives a racing writer time to settle before we
    // re-read and check whether our entry survived.
    await sleep(POSTGREST_RELOAD_MS);
  }

  // The loop's own GETs only ever verify the PREVIOUS iteration's PATCH (GET2
  // checks PATCH1, GET3 checks PATCH2, ...) — there's no 5th iteration to
  // verify attempt 4's PATCH. Without this final read, a PATCH that actually
  // stuck on the last attempt would still be reported as a failure.
  const finalSchemas = await readExposedSchemas(endpoint, headers);
  if (finalSchemas.includes(schemaName)) {
    return;
  }

  throw new Error(
    `Failed to expose schema "${schemaName}" after ${EXPOSE_MAX_ATTEMPTS} attempts — ` +
      `a concurrent provision may be repeatedly overwriting the exposed-schema list`
  );
}

/**
 * Removes `schemaName` from Project B's PostgREST "Exposed schemas" list.
 * MUST be called before dropping a tenant schema: if a dropped schema stays
 * in the list, PostgREST's schema-cache load fails with 3F000 and the entire
 * Data API returns PGRST002 for every tenant.
 *
 * No-op if the schema isn't in the list. Requires `SUPABASE_ACCESS_TOKEN`.
 */
export async function removeExposedSchema(schemaName: string): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("SUPABASE_ACCESS_TOKEN is not set — required to unexpose tenant schemas");
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
  if (!schemas.includes(schemaName)) {
    return;
  }

  const patchRes = await fetch(endpoint, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      db_schema: schemas.filter((s) => s !== schemaName).join(","),
    }),
  });
  if (!patchRes.ok) {
    throw new Error(`Failed to update PostgREST config: ${patchRes.status} ${await patchRes.text()}`);
  }

  // Give PostgREST a moment to reload its schema cache with the new list.
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
