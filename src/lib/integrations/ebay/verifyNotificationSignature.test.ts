import { generateKeyPairSync, createSign } from "crypto";
import { parseSignatureHeader, verifySignature } from "./verifyNotificationSignature";

function signBody(body: string, privateKeyPem: string, digest = "SHA256"): string {
  const signer = createSign(digest);
  signer.update(body, "utf-8");
  signer.end();
  return signer.sign(privateKeyPem, "base64");
}

describe("verifySignature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  it("verifies a correctly signed body", () => {
    const body = JSON.stringify({ notification: { data: { userId: "abc123" } } });
    const signature = signBody(body, privateKey);
    expect(verifySignature(body, signature, publicKey, "SHA256")).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ notification: { data: { userId: "abc123" } } });
    const signature = signBody(body, privateKey);
    const tampered = JSON.stringify({ notification: { data: { userId: "someone-else" } } });
    expect(verifySignature(tampered, signature, publicKey, "SHA256")).toBe(false);
  });

  it("rejects a signature from a different key pair", () => {
    const other = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const body = JSON.stringify({ notification: { data: { userId: "abc123" } } });
    const signature = signBody(body, other.privateKey);
    expect(verifySignature(body, signature, publicKey, "SHA256")).toBe(false);
  });

  it("returns false (not throw) on garbage inputs", () => {
    expect(verifySignature("body", "not-base64!!", publicKey, "SHA256")).toBe(false);
    expect(verifySignature("body", "aGVsbG8=", "not a pem key", "SHA256")).toBe(false);
  });
});

describe("parseSignatureHeader", () => {
  it("parses a valid base64-encoded JSON header", () => {
    const raw = { alg: "ecdsa", digest: "SHA256", signature: "c2ln", kid: "key-1" };
    const header = Buffer.from(JSON.stringify(raw)).toString("base64");
    expect(parseSignatureHeader(header)).toEqual(raw);
  });

  it("returns null for a missing header", () => {
    expect(parseSignatureHeader(null)).toBeNull();
  });

  it("returns null for non-base64 garbage", () => {
    expect(parseSignatureHeader("!!!not valid base64 json!!!")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    const header = Buffer.from(JSON.stringify({ alg: "ecdsa" })).toString("base64");
    expect(parseSignatureHeader(header)).toBeNull();
  });
});
