#!/usr/bin/env node
// ---------------------------------------------------------------------------
// One-off backfill: encrypts any plaintext OAuth tokens left over in
// platform_connections from before src/lib/integrations/tokenCrypto.ts was
// added (2026-07-24 security audit — see AUDIT_2026-07-24.md §2.2).
//
// Not strictly required — every connection re-encrypts itself automatically
// the next time its access token is refreshed (tokenStore.ts's
// ensureValidAccessToken) or the user reconnects the platform. This script
// just closes that window immediately instead of waiting for the next
// natural refresh.
//
// Safe to run multiple times: rows already in the "v1:..." format (see
// ENCRYPTED_PREFIX below — MUST match tokenCrypto.ts's VERSION_PREFIX) are
// skipped.
//
// Usage (service-role keys + TOKEN_ENCRYPTION_KEY come from .env.local):
//   node --env-file=.env.local scripts/encrypt-existing-tokens.mjs [--dry-run]
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js";
import { createCipheriv, randomBytes } from "crypto";

const DRY_RUN = process.argv.includes("--dry-run");

// Keep in sync with src/lib/integrations/tokenCrypto.ts.
const ENCRYPTED_PREFIX = "v1:";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set (generate with: openssl rand -base64 32)");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

function encryptToken(plaintext) {
  if (plaintext == null) return plaintext;
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ENCRYPTED_PREFIX + [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(":");
}

function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

async function main() {
  const control = createClient(
    process.env.CONTROL_SUPABASE_URL,
    process.env.CONTROL_SUPABASE_SERVICE_KEY
  );

  const { data: tenants, error: tenantsError } = await control
    .schema("control")
    .from("tenants")
    .select("schema_name")
    .eq("status", "active");

  if (tenantsError) throw tenantsError;
  if (!tenants?.length) {
    console.log("No active tenants found.");
    return;
  }

  console.log(`${DRY_RUN ? "[dry-run] " : ""}Checking ${tenants.length} tenant(s)...\n`);

  let encryptedCount = 0;
  let skippedCount = 0;

  for (const { schema_name } of tenants) {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { db: { schema: schema_name } }
    );

    const { data: connections, error } = await client
      .from("platform_connections")
      .select("id, platform, access_token, refresh_token");

    if (error) {
      console.error(`  ${schema_name}: failed to read platform_connections — ${error.message}`);
      continue;
    }

    for (const conn of connections ?? []) {
      const needsAccessToken = conn.access_token != null && !isEncrypted(conn.access_token);
      const needsRefreshToken = conn.refresh_token != null && !isEncrypted(conn.refresh_token);

      if (!needsAccessToken && !needsRefreshToken) {
        skippedCount++;
        continue;
      }

      console.log(`  ${schema_name} / ${conn.platform}: encrypting plaintext token(s)`);
      encryptedCount++;

      if (DRY_RUN) continue;

      const update = {};
      if (needsAccessToken) update.access_token = encryptToken(conn.access_token);
      if (needsRefreshToken) update.refresh_token = encryptToken(conn.refresh_token);

      const { error: updateError } = await client
        .from("platform_connections")
        .update(update)
        .eq("id", conn.id);

      if (updateError) {
        console.error(`    failed to update: ${updateError.message}`);
      }
    }
  }

  console.log(
    `\nDone. ${encryptedCount} connection(s) ${DRY_RUN ? "would be" : "were"} encrypted, ${skippedCount} already encrypted or empty.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
