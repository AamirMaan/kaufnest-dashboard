import { decideConnectionSave, defaultDisplayName, type ConnectionSummary } from "./connectionSave";

const row = (id: string, external_account_id: string | null, o: Partial<ConnectionSummary> = {}): ConnectionSummary => ({
  id,
  platform: "ebay",
  status: "connected",
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
  external_account_id,
  ...o,
});

describe("decideConnectionSave", () => {
  it("updates the existing row for a reconnect of the same account, even at the cap", () => {
    const rows = [row("c1", "u1"), row("c2", "u2")];
    expect(decideConnectionSave(rows, "ebay", "u1", "pro")).toEqual({ kind: "update", id: "c1" });
  });

  it("re-checks the cap when reconnecting a disconnected account", () => {
    const rows = [row("c1", "u1", { status: "disconnected" }), row("c2", "u2"), row("c3", "u3")];
    expect(decideConnectionSave(rows, "ebay", "u1", "pro")).toEqual({ kind: "limit" });
    expect(decideConnectionSave(rows, "ebay", "u1", "business")).toEqual({ kind: "update", id: "c1" });
  });

  it("adopts a legacy null-id row of the same platform", () => {
    const rows = [row("legacy", null), row("amz", null, { platform: "amazon" })];
    expect(decideConnectionSave(rows, "ebay", "u1", "pro")).toEqual({ kind: "adopt", id: "legacy" });
  });

  it("inserts a new account under the cap", () => {
    expect(decideConnectionSave([row("c1", "u1")], "ebay", "u2", "pro")).toEqual({ kind: "insert" });
  });

  it("refuses a new account at the cap", () => {
    const rows = [row("c1", "u1"), row("c2", "u2")];
    expect(decideConnectionSave(rows, "ebay", "u3", "pro")).toEqual({ kind: "limit" });
  });

  it("does not count disconnected rows against the cap", () => {
    const rows = [row("c1", "u1"), row("c2", "u2", { status: "disconnected" })];
    expect(decideConnectionSave(rows, "ebay", "u3", "pro")).toEqual({ kind: "insert" });
  });

  it("caps per platform", () => {
    const rows = [row("c1", "a1", { platform: "amazon" }), row("c2", "a2", { platform: "amazon" })];
    expect(decideConnectionSave(rows, "ebay", "u1", "pro")).toEqual({ kind: "insert" });
  });
});

describe("defaultDisplayName", () => {
  it("uses the eBay username", () => {
    expect(defaultDisplayName("ebay", "u-1", "main_store")).toBe("main_store");
  });
  it("uses the last 6 characters of the Amazon seller id", () => {
    expect(defaultDisplayName("amazon", "A1B2C3D4E5F6G7")).toBe("Amazon – E5F6G7");
  });
});
