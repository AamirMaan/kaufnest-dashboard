import { createHmac } from "crypto";
import { verifyWebhookSignature } from "./signature";

const SECRET = "trello-app-secret";
const CALLBACK = "https://app.example.com/api/support/trello-webhook";
const BODY = JSON.stringify({ action: { type: "updateCard" } });

function sign(body: string, callback: string, secret = SECRET): string {
  return createHmac("sha1", secret).update(body + callback).digest("base64");
}

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed payload", () => {
    expect(verifyWebhookSignature(BODY, sign(BODY, CALLBACK), SECRET, CALLBACK)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = sign(BODY, CALLBACK);
    const tampered = JSON.stringify({ action: { type: "deleteCard" } });
    expect(verifyWebhookSignature(tampered, sig, SECRET, CALLBACK)).toBe(false);
  });

  it("rejects a signature computed for a different callback URL", () => {
    const sig = sign(BODY, "https://evil.example.com/hook");
    expect(verifyWebhookSignature(BODY, sig, SECRET, CALLBACK)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(
      verifyWebhookSignature(BODY, sign(BODY, CALLBACK, "wrong"), SECRET, CALLBACK)
    ).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyWebhookSignature(BODY, null, SECRET, CALLBACK)).toBe(false);
  });

  it("rejects a malformed header without throwing", () => {
    expect(verifyWebhookSignature(BODY, "!!!not-base64!!!", SECRET, CALLBACK)).toBe(false);
  });
});
