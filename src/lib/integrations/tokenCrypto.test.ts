import { randomBytes } from "crypto";
import { encryptToken, decryptToken, isEncryptedToken } from "./tokenCrypto";

const ORIGINAL_ENV = process.env.TOKEN_ENCRYPTION_KEY;

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = ORIGINAL_ENV;
});

describe("encryptToken / decryptToken", () => {
  it("round-trips a token", () => {
    const plaintext = "v^1.1#i^1#f^0#p^1#r^0#I^3#t^Ul4xMF8xOjE0N0M4RTM2NjZBMzE4RTkzMEE0RUY4RTlDNzY1RTFEXzNfMSNFXjI2MA==";
    const encrypted = encryptToken(plaintext);
    expect(encrypted).not.toEqual(plaintext);
    expect(encrypted).toMatch(/^v1:/);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptToken("same-token");
    const b = encryptToken("same-token");
    expect(a).not.toEqual(b);
  });

  it("passes null/undefined through unchanged", () => {
    expect(encryptToken(null)).toBeNull();
    expect(encryptToken(undefined)).toBeNull();
    expect(decryptToken(null)).toBeNull();
    expect(decryptToken(undefined)).toBeNull();
  });

  it("treats an unprefixed value as legacy plaintext and returns it unchanged", () => {
    const legacyPlaintext = "some-old-unencrypted-token";
    expect(decryptToken(legacyPlaintext)).toBe(legacyPlaintext);
  });

  it("throws when the ciphertext has been tampered with", () => {
    const encrypted = encryptToken("a-real-token")!;
    const tampered = encrypted.slice(0, -4) + "abcd";
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws a clear error when TOKEN_ENCRYPTION_KEY is missing", () => {
    const saved = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(/TOKEN_ENCRYPTION_KEY is not set/);
    process.env.TOKEN_ENCRYPTION_KEY = saved;
  });

  it("throws when TOKEN_ENCRYPTION_KEY is the wrong length", () => {
    const saved = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptToken("x")).toThrow(/32 bytes/);
    process.env.TOKEN_ENCRYPTION_KEY = saved;
  });
});

describe("isEncryptedToken", () => {
  it("returns true for a v1-prefixed value", () => {
    expect(isEncryptedToken(encryptToken("x"))).toBe(true);
  });

  it("returns false for legacy plaintext, null, and undefined", () => {
    expect(isEncryptedToken("plain-old-token")).toBe(false);
    expect(isEncryptedToken(null)).toBe(false);
    expect(isEncryptedToken(undefined)).toBe(false);
  });
});
