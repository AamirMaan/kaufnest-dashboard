import {
  resolveActiveAccounts,
  accountState,
  canResumeAccount,
  connectedCount,
  firstUsableAccount,
  type AccountLike,
} from "./activeAccounts";

const acc = (id: string, overrides: Partial<AccountLike> = {}): AccountLike => ({
  id,
  platform: "ebay",
  status: "connected",
  is_active: true,
  created_at: `2026-01-0${id.replace(/\D/g, "") || "1"}T00:00:00.000Z`,
  ...overrides,
});

describe("resolveActiveAccounts", () => {
  it("keeps every account active under the cap", () => {
    const { active, paused } = resolveActiveAccounts([acc("a1"), acc("a2")], "pro");
    expect(active.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(paused).toEqual([]);
  });

  it("over the cap, the oldest non-paused accounts stay active", () => {
    const rows = [acc("a3"), acc("a1"), acc("a4"), acc("a2")];
    const { active, paused } = resolveActiveAccounts(rows, "pro");
    expect(active.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(paused.map((a) => a.id).sort()).toEqual(["a3", "a4"]);
  });

  it("an admin pause always holds, and frees a slot for the next oldest", () => {
    const rows = [acc("a1", { is_active: false }), acc("a2"), acc("a3"), acc("a4")];
    const { active, paused } = resolveActiveAccounts(rows, "pro");
    expect(active.map((a) => a.id)).toEqual(["a2", "a3"]);
    expect(paused.map((a) => a.id).sort()).toEqual(["a1", "a4"]);
  });

  it("an admin pause holds even under the cap", () => {
    const { active, paused } = resolveActiveAccounts([acc("a1", { is_active: false }), acc("a2")], "pro");
    expect(active.map((a) => a.id)).toEqual(["a2"]);
    expect(paused.map((a) => a.id)).toEqual(["a1"]);
  });

  it("is unlimited on business and trial", () => {
    const rows = [acc("a1"), acc("a2"), acc("a3"), acc("a4")];
    expect(resolveActiveAccounts(rows, "business").active).toHaveLength(4);
    expect(resolveActiveAccounts(rows, "trial").active).toHaveLength(4);
  });

  it("starter has no active accounts", () => {
    const { active, paused } = resolveActiveAccounts([acc("a1")], "starter");
    expect(active).toEqual([]);
    expect(paused.map((a) => a.id)).toEqual(["a1"]);
  });

  it("ignores disconnected and errored rows", () => {
    const rows = [acc("a1", { status: "disconnected" }), acc("a2", { status: "error" }), acc("a3")];
    const { active, paused } = resolveActiveAccounts(rows, "pro");
    expect(active.map((a) => a.id)).toEqual(["a3"]);
    expect(paused).toEqual([]);
  });

  it("caps each platform independently", () => {
    const rows = [
      acc("a1"), acc("a2"), acc("a3"),
      acc("a4", { platform: "amazon" }), acc("a5", { platform: "amazon" }),
    ];
    const { active } = resolveActiveAccounts(rows, "pro");
    expect(active.map((a) => a.id)).toEqual(["a1", "a2", "a4", "a5"]);
  });
});

describe("accountState", () => {
  const rows = [acc("a1"), acc("a2"), acc("a3"), acc("a4", { is_active: false }), acc("a5", { status: "disconnected" }), acc("a6", { status: "error" })];
  it.each([
    ["a1", "active"],
    ["a3", "plan_limit"],
    ["a4", "paused"],
    ["a5", "disconnected"],
    ["a6", "error"],
  ])("%s is %s on pro", (id, expected) => {
    expect(accountState(rows, id, "pro")).toBe(expected);
  });
});

describe("canResumeAccount", () => {
  it("allows resuming when the non-paused count is under the cap", () => {
    expect(canResumeAccount([acc("a1"), acc("a2", { is_active: false })], "a2", "pro")).toBe(true);
  });
  it("refuses resuming when the platform is already full", () => {
    expect(canResumeAccount([acc("a1"), acc("a2"), acc("a3", { is_active: false })], "a3", "pro")).toBe(false);
  });
  it("only counts the target's platform", () => {
    const rows = [acc("a1"), acc("a2"), acc("a3", { platform: "amazon", is_active: false })];
    expect(canResumeAccount(rows, "a3", "pro")).toBe(true);
  });
  it("is false for an unknown id", () => {
    expect(canResumeAccount([acc("a1")], "zzz", "pro")).toBe(false);
  });
});

describe("connectedCount", () => {
  it("counts connected and errored rows of one platform, not disconnected ones", () => {
    const rows = [acc("a1"), acc("a2", { status: "error" }), acc("a3", { status: "disconnected" }), acc("a4", { platform: "amazon" })];
    expect(connectedCount(rows, "ebay")).toBe(2);
  });
});

describe("firstUsableAccount", () => {
  it("returns the oldest connected, non-paused account of the platform", () => {
    const rows = [acc("a3"), acc("a1", { is_active: false }), acc("a2")];
    expect(firstUsableAccount(rows, "ebay")?.id).toBe("a2");
  });
  it("returns null when every account is paused or disconnected", () => {
    expect(firstUsableAccount([acc("a1", { is_active: false }), acc("a2", { status: "disconnected" })], "ebay")).toBeNull();
  });
});

describe("ordering tie-break", () => {
  it("orders rows sharing a created_at by id, regardless of input order", () => {
    const same = "2026-03-01T00:00:00.000Z";
    const rows = [acc("c", { created_at: same }), acc("b", { created_at: same }), acc("a", { created_at: same })];
    expect(firstUsableAccount(rows, "ebay")?.id).toBe("a");
    expect(firstUsableAccount([...rows].reverse(), "ebay")?.id).toBe("a");
    expect(resolveActiveAccounts(rows, "pro").active.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
