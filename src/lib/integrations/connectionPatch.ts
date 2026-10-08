export type ConnectionPatch = { display_name?: string; is_active?: boolean };

const MAX_NAME = 60;

/** Validates PATCH /api/integrations/connections/[id] bodies. */
export function parseConnectionPatch(
  body: unknown
): { ok: true; patch: ConnectionPatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request body." };
  const raw = body as Record<string, unknown>;
  const patch: ConnectionPatch = {};

  if ("display_name" in raw) {
    if (typeof raw.display_name !== "string") return { ok: false, error: "Account name must be text." };
    const name = raw.display_name.trim();
    if (name.length < 1 || name.length > MAX_NAME) {
      return { ok: false, error: `Account name must be 1–${MAX_NAME} characters.` };
    }
    patch.display_name = name;
  }
  if ("is_active" in raw) {
    if (typeof raw.is_active !== "boolean") return { ok: false, error: "Invalid active flag." };
    patch.is_active = raw.is_active;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update." };
  return { ok: true, patch };
}
