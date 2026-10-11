import { resolveSaleEbayAccount } from "./saleAccount";
import type { AccountLike } from "@/lib/utils/activeAccounts";

const row = (id: string, o: Partial<AccountLike> = {}): AccountLike => ({
  id,
  platform: "ebay",
  status: "connected",
  is_active: true,
  created_at: `2026-01-0${id.slice(-1)}T00:00:00.000Z`,
  ...o,
});

describe("resolveSaleEbayAccount", () => {
  it("uses the sale's own active account", () => {
    const rows = [row("c1"), row("c2")];
    expect(resolveSaleEbayAccount(rows, "c2")).toEqual({ ok: true, account: rows[1] });
  });

  it("still fulfils through a paused account (existing orders keep shipping)", () => {
    const rows = [row("c1", { is_active: false })];
    expect(resolveSaleEbayAccount(rows, "c1")).toEqual({ ok: true, account: rows[0] });
  });

  it("refuses a disconnected or errored account", () => {
    expect(resolveSaleEbayAccount([row("c1", { status: "disconnected" })], "c1")).toMatchObject({
      code: "INTEGRATION_ACCOUNT_DISCONNECTED",
    });
    expect(resolveSaleEbayAccount([row("c1", { status: "error" })], "c1")).toMatchObject({
      code: "INTEGRATION_ACCOUNT_DISCONNECTED",
    });
  });

  it("refuses an unknown or non-eBay account", () => {
    expect(resolveSaleEbayAccount([row("c1", { platform: "amazon" })], "c1")).toMatchObject({
      code: "INTEGRATION_ACCOUNT_UNKNOWN",
    });
  });

  it("uses the single eBay account for an unassigned sale", () => {
    const rows = [row("c1"), row("c2", { status: "disconnected" }), row("c3", { platform: "amazon" })];
    expect(resolveSaleEbayAccount(rows, null)).toEqual({ ok: true, account: rows[0] });
  });

  it("refuses to guess an unassigned sale's account when there are several", () => {
    expect(resolveSaleEbayAccount([row("c1"), row("c2")], null)).toEqual({
      ok: false,
      code: "INTEGRATION_ACCOUNT_AMBIGUOUS",
    });
  });

  it("reports no eBay account for an unassigned sale", () => {
    expect(resolveSaleEbayAccount([], null)).toMatchObject({ code: "INTEGRATION_ACCOUNT_DISCONNECTED" });
  });
});
