const MAX_SLUG_LENGTH = 40;
const MAX_COLLISION_ATTEMPTS = 100;

/**
 * The exact sanitisation /api/admin/provision-tenant has always applied.
 * Extracted so self-serve signup and admin provisioning cannot drift into
 * producing different schema names for the same company name.
 *
 * Note the order: characters outside [a-z0-9-] are stripped FIRST, so spaces
 * vanish rather than becoming separators ("Acme GmbH" → "acmegmbh").
 */
export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-/g, "_")
    .slice(0, MAX_SLUG_LENGTH);
}

/**
 * A slug guaranteed to be non-empty.
 *
 * Self-serve signup accepts arbitrary company names from the open internet.
 * A name with no ASCII alphanumerics sanitises to "", which would build the
 * schema name `tenant_` — and that passes provision_tenant_schema's
 * `schema_name LIKE 'tenant_%'` guard, silently creating a real schema with
 * a name every subsequent unusable-name signup would also want. Falls back to
 * the email local part, then to a constant.
 */
export function slugForCompany(companyName: string, email: string): string {
  const fromCompany = sanitizeSlug(companyName);
  if (fromCompany) return fromCompany;

  const fromEmail = sanitizeSlug(email.split("@")[0] ?? "");
  if (fromEmail) return fromEmail;

  return "tenant";
}

export function schemaNameFor(slug: string): string {
  return `tenant_${slug}`;
}

/**
 * First free slug in the `base`, `base_2`, `base_3` … sequence.
 * Bounded so a pathological `taken` list can never hang a request.
 */
export function nextAvailableSlug(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;

  for (let n = 2; n <= MAX_COLLISION_ATTEMPTS; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.includes(candidate)) return candidate;
  }

  throw new Error(`No available slug for "${base}" after ${MAX_COLLISION_ATTEMPTS} attempts`);
}
