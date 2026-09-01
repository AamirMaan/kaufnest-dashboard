import { currentPeriod, sumCalls, callsByUser, type UsageRow } from "./quota";

describe("currentPeriod", () => {
  it("returns the first day of the month in UTC", () => {
    expect(currentPeriod(new Date("2026-09-17T23:30:00Z"))).toBe("2026-09-01");
  });

  it("uses UTC, not local time, at a month boundary", () => {
    // 23:30 on Aug 31 UTC is already September in some local zones — the
    // billing period must not depend on where the server happens to run.
    expect(currentPeriod(new Date("2026-08-31T23:30:00Z"))).toBe("2026-08-01");
  });

  it("zero-pads single-digit months", () => {
    expect(currentPeriod(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-01");
  });
});

describe("sumCalls", () => {
  const rows: UsageRow[] = [
    { user_id: "u1", kind: "describe", calls: 3 },
    { user_id: "u1", kind: "aspects", calls: 2 },
    { user_id: "u2", kind: "describe", calls: 5 },
  ];

  it("totals every row regardless of user or kind", () => {
    expect(sumCalls(rows)).toBe(10);
  });

  it("returns zero for no usage", () => {
    expect(sumCalls([])).toBe(0);
  });
});

describe("callsByUser", () => {
  it("collapses both kinds into one total per user", () => {
    const rows: UsageRow[] = [
      { user_id: "u1", kind: "describe", calls: 3 },
      { user_id: "u1", kind: "aspects", calls: 2 },
      { user_id: "u2", kind: "describe", calls: 5 },
    ];
    expect(callsByUser(rows)).toEqual({ u1: 5, u2: 5 });
  });
});
