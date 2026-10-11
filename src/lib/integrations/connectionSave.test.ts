import {
  connectPrecheck,
  decideConnectionSave,
  defaultDisplayName,
  displayNameForSave,
  type ConnectionSummary,
} from "./connectionSave";

import { NO_ENTITLEMENTS, type PlanEntitlements } from "@/lib/plans/entitlements";

// The seeded control.plans caps (012): starter 0, pro 2, business/trial unlimited.
const withCap = (n: number): PlanEntitlements => ({ ...NO_ENTITLEMENTS, platformIntegrations: n > 0, maxAccountsPerPlatform: n });
const ENT = { starter: withCap(0), pro: withCap(2), business: withCap(Infinity), trial: withCap(Infinity) };

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
    expect(decideConnectionSave(rows, "ebay", "u1", ENT.pro)).toEqual({ kind: "update", id: "c1" });
  });

  it("re-checks the cap when reconnecting a disconnected account", () => {
    const rows = [row("c1", "u1", { status: "disconnected" }), row("c2", "u2"), row("c3", "u3")];
    expect(decideConnectionSave(rows, "ebay", "u1", ENT.pro)).toEqual({ kind: "limit" });
    expect(decideConnectionSave(rows, "ebay", "u1", ENT.business)).toEqual({ kind: "update", id: "c1" });
  });

  it("adopts a legacy null-id row only when the admin reconnected that row", () => {
    const rows = [row("legacy", null), row("amz", null, { platform: "amazon" })];
    expect(decideConnectionSave(rows, "ebay", "u1", ENT.pro, "legacy")).toEqual({ kind: "adopt", id: "legacy" });
  });

  it("never adopts a legacy row implicitly — an Add-account sign-in may be another seller", () => {
    const rows = [row("legacy", null)];
    expect(decideConnectionSave(rows, "ebay", "u2", ENT.pro)).toEqual({ kind: "legacy_pending" });
    expect(decideConnectionSave(rows, "ebay", "u2", ENT.pro, "other-id")).toEqual({ kind: "legacy_pending" });
  });

  it("does not let a disconnected legacy row block adding accounts", () => {
    const rows = [row("legacy", null, { status: "disconnected" })];
    expect(decideConnectionSave(rows, "ebay", "u2", ENT.pro)).toEqual({ kind: "insert" });
  });

  it("re-checks the cap when adopting a disconnected legacy row", () => {
    const rows = [row("legacy", null, { status: "disconnected" }), row("c2", "u2"), row("c3", "u3")];
    expect(decideConnectionSave(rows, "ebay", "u1", ENT.pro, "legacy")).toEqual({ kind: "limit" });
  });

  it("updates the matching account even when a legacy row is pending", () => {
    const rows = [row("legacy", null), row("c1", "u1")];
    expect(decideConnectionSave(rows, "ebay", "u1", ENT.pro)).toEqual({ kind: "update", id: "c1" });
  });

  it("inserts a new account under the cap", () => {
    expect(decideConnectionSave([row("c1", "u1")], "ebay", "u2", ENT.pro)).toEqual({ kind: "insert" });
  });

  it("refuses a new account at the cap", () => {
    const rows = [row("c1", "u1"), row("c2", "u2")];
    expect(decideConnectionSave(rows, "ebay", "u3", ENT.pro)).toEqual({ kind: "limit" });
  });

  it("does not count disconnected rows against the cap", () => {
    const rows = [row("c1", "u1"), row("c2", "u2", { status: "disconnected" })];
    expect(decideConnectionSave(rows, "ebay", "u3", ENT.pro)).toEqual({ kind: "insert" });
  });

  it("caps per platform", () => {
    const rows = [row("c1", "a1", { platform: "amazon" }), row("c2", "a2", { platform: "amazon" })];
    expect(decideConnectionSave(rows, "ebay", "u1", ENT.pro)).toEqual({ kind: "insert" });
  });
});

describe("connectPrecheck", () => {
  it("lets a reconnect of a known row through, even at the cap", () => {
    const rows = [row("c1", "u1"), row("c2", "u2")];
    expect(connectPrecheck(rows, "ebay", ENT.pro, "c1")).toBe("ok");
  });

  it("rejects a reconnect target that isn't one of the platform's rows", () => {
    const rows = [row("c1", "u1"), row("amz", "a1", { platform: "amazon" })];
    expect(connectPrecheck(rows, "ebay", ENT.pro, "amz")).toBe("unknown_target");
    expect(connectPrecheck(rows, "ebay", ENT.pro, "nope")).toBe("unknown_target");
  });

  it("asks for the legacy row to be reconnected before adding an account", () => {
    expect(connectPrecheck([row("legacy", null)], "ebay", ENT.business, null)).toBe("legacy_pending");
  });

  it("checks the cap when adding", () => {
    expect(connectPrecheck([row("c1", "u1"), row("c2", "u2")], "ebay", ENT.pro, null)).toBe("limit");
    expect(connectPrecheck([row("c1", "u1")], "ebay", ENT.pro, null)).toBe("ok");
  });
});

describe("displayNameForSave", () => {
  it("always names an inserted row", () => {
    expect(displayNameForSave({ kind: "insert" }, null, "shop_a")).toBe("shop_a");
  });

  it("replaces 056's placeholder on an adopted legacy row", () => {
    expect(displayNameForSave({ kind: "adopt", id: "x" }, "eBay account", "shop_a")).toBe("shop_a");
    expect(displayNameForSave({ kind: "update", id: "x" }, "Amazon – account", "Amazon – E5F6G7")).toBe("Amazon – E5F6G7");
  });

  it("fills an empty name", () => {
    expect(displayNameForSave({ kind: "update", id: "x" }, null, "shop_a")).toBe("shop_a");
  });

  it("keeps an admin's rename", () => {
    expect(displayNameForSave({ kind: "adopt", id: "x" }, "Main store", "shop_a")).toBeUndefined();
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
