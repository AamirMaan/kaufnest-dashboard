import type { IntegrationPlatform, PlatformConnectionStatus, TenantPlan } from "@/types";
import type { IntegrationsClient, PlatformAdapter } from "./types";
import { encryptToken, decryptToken } from "./tokenCrypto";
import { firstUsableAccount, resolveActiveAccounts } from "@/lib/utils/activeAccounts";
import type { IntegrationErrorCode } from "@/lib/utils/integrationErrors";

/** Full `platform_connections` row, including the OAuth tokens — server-only. */
export interface ConnectionRow {
  id: string;
  platform: IntegrationPlatform;
  status: PlatformConnectionStatus;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  external_account_id: string | null;
  external_username: string | null;
  display_name: string | null;
  is_active: boolean;
  marketplace_id: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  connected_by: string | null;
  created_at: string;
}

export type ConnectionFields = Partial<Omit<ConnectionRow, "id" | "platform" | "created_at">>;

export class IntegrationAccountError extends Error {
  constructor(public code: IntegrationErrorCode) {
    super(code);
  }
}

function decryptRow(row: ConnectionRow): ConnectionRow {
  return { ...row, access_token: decryptToken(row.access_token), refresh_token: decryptToken(row.refresh_token) };
}

function encryptFields(fields: ConnectionFields): ConnectionFields {
  const out = { ...fields };
  if ("access_token" in out) out.access_token = encryptToken(out.access_token);
  if ("refresh_token" in out) out.refresh_token = encryptToken(out.refresh_token);
  return out;
}

/**
 * Every account row (optionally one platform), tokens decrypted.
 * Bounded: one row per connected seller account, capped by plan (Business is
 * unlimited, but accounts are a handful per tenant, not a growth quantity of
 * business records).
 */
export async function listConnections(
  client: IntegrationsClient,
  platform?: IntegrationPlatform
): Promise<ConnectionRow[]> {
  // verifier:allow unpaginated-collection-read — one row per seller account, a handful per tenant
  let query = client.from("platform_connections").select("*").order("created_at", { ascending: true });
  if (platform) query = query.eq("platform", platform);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as ConnectionRow[]).map(decryptRow);
}

export async function getConnectionById(client: IntegrationsClient, id: string): Promise<ConnectionRow | null> {
  const { data, error } = await client.from("platform_connections").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? decryptRow(data as ConnectionRow) : null;
}

/**
 * COMPATIBILITY SHIM (multi-account sub-project 1): "the" account for a
 * platform = the oldest connected, non-paused one. Listings, messages and
 * dropshipping still call this; sub-projects 2/3 move them to
 * getConnectionById and then this is deleted. New code must not call it.
 */
export async function getConnection(
  client: IntegrationsClient,
  platform: IntegrationPlatform
): Promise<ConnectionRow | null> {
  return firstUsableAccount(await listConnections(client, platform), platform);
}

export async function updateConnection(client: IntegrationsClient, id: string, fields: ConnectionFields): Promise<void> {
  const { error } = await client.from("platform_connections").update(encryptFields(fields)).eq("id", id);
  if (error) throw error;
}

export async function insertConnection(
  client: IntegrationsClient,
  platform: IntegrationPlatform,
  fields: ConnectionFields
): Promise<string> {
  const { data, error } = await client
    .from("platform_connections")
    .insert({ platform, ...encryptFields(fields) })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** The account, if it exists and is active under the plan; otherwise throws IntegrationAccountError. */
export async function requireActiveConnection(
  client: IntegrationsClient,
  id: string,
  plan: TenantPlan
): Promise<ConnectionRow> {
  const rows = await listConnections(client);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new IntegrationAccountError("INTEGRATION_ACCOUNT_UNKNOWN");
  if (!resolveActiveAccounts(rows, plan).active.some((r) => r.id === id)) {
    throw new IntegrationAccountError("INTEGRATION_ACCOUNT_PAUSED");
  }
  return row;
}

// Refresh the access token a few minutes before it actually expires, to
// avoid races where it expires mid-request.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Returns a usable access token for `connection`, refreshing and persisting
 * a new one via `adapter.refreshAccessToken` if the stored token is missing
 * or close to expiry.
 */
export async function ensureValidAccessToken(
  client: IntegrationsClient,
  connection: ConnectionRow,
  adapter: PlatformAdapter
): Promise<string> {
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;

  if (connection.access_token && expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return connection.access_token;
  }

  if (!connection.refresh_token) {
    throw new Error(`No refresh token stored for ${adapter.platform} connection`);
  }

  const tokens = await adapter.refreshAccessToken(connection.refresh_token);

  await updateConnection(client, connection.id, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || connection.refresh_token,
    token_expires_at: tokens.expires_at,
  });

  return tokens.access_token;
}
