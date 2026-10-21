import { generateKeyPairSync, verify } from "crypto";
import { loadSigningConfig, signatureBase, signatureHeaders } from "./signature";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pkcs8Pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pkcs8Base64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const URL_ = "https://apiz.ebay.com/sell/finances/v1/transaction?filter=x&limit=1000&offset=0";

describe("loadSigningConfig", () => {
  it("returns null when either env var is missing", () => {
    expect(loadSigningConfig({})).toBeNull();
    expect(loadSigningConfig({ EBAY_SIGNING_PRIVATE_KEY: pkcs8Pem })).toBeNull();
    expect(loadSigningConfig({ EBAY_SIGNING_JWE: "jwe" })).toBeNull();
  });

  it("accepts a PEM key, a PEM key with escaped newlines, and bare base64 PKCS#8 (Key Management API output)", () => {
    for (const key of [pkcs8Pem, pkcs8Pem.replace(/\n/g, "\\n"), pkcs8Base64]) {
      const cfg = loadSigningConfig({ EBAY_SIGNING_PRIVATE_KEY: key, EBAY_SIGNING_JWE: "jwe" });
      expect(cfg?.jwe).toBe("jwe");
      expect(cfg?.privateKey.asymmetricKeyType).toBe("ed25519");
    }
  });
});

describe("signatureBase", () => {
  it("builds the RFC 9421 base eBay expects for a request without a body (path excludes the query)", () => {
    expect(signatureBase("GET", URL_, "the-jwe", 1700000000)).toBe(
      [
        '"x-ebay-signature-key": the-jwe',
        '"@method": GET',
        '"@path": /sell/finances/v1/transaction',
        '"@authority": apiz.ebay.com',
        '"@signature-params": ("x-ebay-signature-key" "@method" "@path" "@authority");created=1700000000',
      ].join("\n")
    );
  });
});

describe("signatureHeaders", () => {
  it("emits the three headers with a signature that verifies against the base", () => {
    const cfg = { privateKey, jwe: "the-jwe" };
    const h = signatureHeaders("GET", URL_, cfg, 1700000000_000);

    expect(h["x-ebay-signature-key"]).toBe("the-jwe");
    expect(h["Signature-Input"]).toBe('sig1=("x-ebay-signature-key" "@method" "@path" "@authority");created=1700000000');
    const m = /^sig1=:(.+):$/.exec(h.Signature);
    expect(m).not.toBeNull();
    const ok = verify(null, Buffer.from(signatureBase("GET", URL_, "the-jwe", 1700000000)), publicKey, Buffer.from(m![1], "base64"));
    expect(ok).toBe(true);
  });
});
