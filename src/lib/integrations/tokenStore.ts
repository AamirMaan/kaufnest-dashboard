import type { IntegrationPlatform, PlatformConnectionStatus } from "@/types";
import type { IntegrationsClient, PlatformAdapter } from "./types";
import { encryptToken, decryptToken } from "./tokenCrypto";

/** Full `platform_connections` row, including the OAuth tokens — server-only. */
export interface ConnectionRow {
  id: string;
  platform: IntegrationPlatform;
  status: PlatformConnectionStatus;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  external_account_id: string | null;
  marketplace_id: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  connected_by: string | null;
}

export async function getConnection(
  client: IntegrationsClient,
  platform: IntegrationPlatform
): Promise<ConnectionRow | null> {
  const { data, error } = await client
    .from("platform_connections")
    .select("*")
    .eq("platform", platform)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as ConnectionRow;
  return {
    ...row,
    access_token: decryptToken(row.access_token),
    refresh_token: decryptToken(row.refresh_token),
  };
}

export async function upsertConnection(
  client: IntegrationsClient,
  platform: IntegrationPlatform,
  fields: Partial<Omit<ConnectionRow, "id" | "platform">>
): Promise<void> {
  const encryptedFields = { ...fields };
  if ("access_token" in encryptedFields) {
    encryptedFields.access_token = encryptToken(encryptedFields.access_token);
  }
  if ("refresh_token" in encryptedFields) {
    encryptedFields.refresh_token = encryptToken(encryptedFields.refresh_token);
  }

  const { error } = await client
    .from("platform_connections")
    .upsert({ platform, ...encryptedFields }, { onConflict: "platform" });

  if (error) throw error;
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

  await upsertConnection(client, adapter.platform, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || connection.refresh_token,
    token_expires_at: tokens.expires_at,
  });

  return tokens.access_token;
}
