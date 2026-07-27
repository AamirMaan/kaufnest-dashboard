import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Encrypts OAuth access/refresh tokens (eBay/Amazon) before they're persisted
// to platform_connections, so a raw table read (leaked service-role key, SQL
// injection elsewhere, a backup dump) doesn't yield usable seller credentials.
// Used exclusively by tokenStore.ts — never call these directly from a route.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended nonce length for GCM
// Prefixes every ciphertext so decryptToken() can tell an already-encrypted
// value apart from a legacy plaintext token written before this was added —
// legacy values pass through unchanged rather than failing to decrypt, so
// existing connections keep working until they're next refreshed/reconnected
// (or backfilled via scripts/encrypt-existing-tokens.mjs).
const VERSION_PREFIX = "v1:";

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set — required to store/read OAuth tokens. " +
        "Generate one with: openssl rand -base64 32"
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes — generate with: openssl rand -base64 32"
    );
  }
  return key;
}

/** Encrypts a token for storage. `null` passes through unchanged (nothing to store). */
export function encryptToken(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return plaintext ?? null;

  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return (
    VERSION_PREFIX +
    [iv, authTag, ciphertext].map((buf) => buf.toString("base64")).join(":")
  );
}

/**
 * Decrypts a token read from storage. A value without the `v1:` prefix is
 * treated as legacy plaintext and returned unchanged (see VERSION_PREFIX
 * comment above) — this is what makes rollout non-breaking.
 */
export function decryptToken(stored: string | null | undefined): string | null {
  if (stored == null) return stored ?? null;
  if (!stored.startsWith(VERSION_PREFIX)) return stored;

  const parts = stored.slice(VERSION_PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token value (expected iv:authTag:ciphertext)");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;

  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf-8");
}

/** True if `stored` is already in the encrypted (`v1:`-prefixed) format. */
export function isEncryptedToken(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(VERSION_PREFIX);
}
