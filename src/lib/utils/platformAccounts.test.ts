import { hasMultipleAccounts, accountOptionsFor, accountName, accountLabel, accountForImportRow, UNASSIGNED_ACCOUNT } from "./platformAccounts";
import type { PlatformAccount } from "@/types";

const a = (id: string, platform: "ebay" | "amazon", created_at: string, display_name: string | null = id): PlatformAccount => ({
  id,
  platform,
  display_name,
  status: "connected",
  is_active: true,
  created_at,
});

describe("platformAccounts", () => {
  const accounts = [a("e2", "ebay", "2026-02-01"), a("e1", "ebay", "2026-01-01"), a("m1", "amazon", "2026-01-01", null)];

  it("UNASSIGNED_ACCOUNT matches the SQL sentinel in 056", () => {
    expect(UNASSIGNED_ACCOUNT).toBe("__unassigned__");
  });
  it("hasMultipleAccounts is true only with 2+ on one platform", () => {
    expect(hasMultipleAccounts(accounts)).toBe(true);
    expect(hasMultipleAccounts([accounts[0], accounts[2]])).toBe(false);
  });
  it("accountOptionsFor returns one platform's accounts, oldest first", () => {
    expect(accountOptionsFor(accounts, "ebay").map((x) => x.id)).toEqual(["e1", "e2"]);
    expect(accountOptionsFor(accounts, "etsy")).toEqual([]);
  });
  it("accountName resolves ids and falls back to a generic label", () => {
    expect(accountName(accounts, "e1")).toBe("e1");
    expect(accountName(accounts, "m1")).toBe("Amazon account");
    expect(accountName(accounts, null)).toBeNull();
    expect(accountName(accounts, "gone")).toBeNull();
  });
  it("accountLabel prefers the display name", () => {
    expect(accountLabel(accounts[0])).toBe("e2");
  });
});

describe("accountForImportRow", () => {
  const ebay = a("e1", "ebay", "2026-01-01", "Main");
  it("assigns the account to rows of its platform", () => {
    expect(accountForImportRow("ebay", ebay)).toBe("e1");
  });
  it("leaves other platforms and no-selection unassigned", () => {
    expect(accountForImportRow("amazon", ebay)).toBeNull();
    expect(accountForImportRow("ebay", null)).toBeNull();
  });
});
