import { computePending } from "./platformBalance";
import type { PlatformPayout } from "@/types";

const payout = (amount: number): PlatformPayout => ({
  id: "1",
  platform: "ebay",
  amount,
  currency: "EUR",
  date: "2026-07-01",
  notes: null,
  created_by: "u1",
  created_at: "2026-07-01T00:00:00Z",
});

describe("computePending", () => {
  it("returns balance unchanged when no payouts", () => {
    expect(computePending(500, [])).toBe(500);
  });

  it("subtracts all supplied payouts from balance", () => {
    expect(computePending(500, [payout(200), payout(100)])).toBe(200);
  });

  it("returns negative when over-transferred", () => {
    expect(computePending(100, [payout(150)])).toBe(-50);
  });
});
