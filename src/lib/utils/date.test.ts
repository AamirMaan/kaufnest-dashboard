import { getMonthRange, formatDate, formatDateTime } from "@/lib/utils/date";

describe("getMonthRange", () => {
  it("returns correct first and last day for January", () => {
    const { from, to } = getMonthRange(2024, 1);
    expect(from).toBe("2024-01-01");
    expect(to).toBe("2024-01-31");
  });

  it("returns correct first and last day for February in a leap year", () => {
    const { from, to } = getMonthRange(2024, 2);
    expect(from).toBe("2024-02-01");
    expect(to).toBe("2024-02-29");
  });

  it("returns correct first and last day for February in a non-leap year", () => {
    const { from, to } = getMonthRange(2023, 2);
    expect(from).toBe("2023-02-01");
    expect(to).toBe("2023-02-28");
  });

  it("returns correct range for December", () => {
    const { from, to } = getMonthRange(2024, 12);
    expect(from).toBe("2024-12-01");
    expect(to).toBe("2024-12-31");
  });

  it("returns correct range for April (30-day month)", () => {
    const { from, to } = getMonthRange(2024, 4);
    expect(from).toBe("2024-04-01");
    expect(to).toBe("2024-04-30");
  });

  it("returns correct range for June (30-day month)", () => {
    const { from, to } = getMonthRange(2026, 6);
    expect(from).toBe("2026-06-01");
    expect(to).toBe("2026-06-30");
  });

  it("from date is always the 1st", () => {
    for (let month = 1; month <= 12; month++) {
      const { from } = getMonthRange(2024, month);
      expect(from.endsWith("-01")).toBe(true);
    }
  });

  it("to date day is always >= 28", () => {
    for (let month = 1; month <= 12; month++) {
      const { to } = getMonthRange(2024, month);
      const day = parseInt(to.split("-")[2]);
      expect(day).toBeGreaterThanOrEqual(28);
    }
  });
});

describe("formatDate", () => {
  it("formats an ISO date to German dd.mm.yyyy format", () => {
    const result = formatDate("2024-06-15");
    expect(result).toBe("15.06.2024");
  });

  it("formats January correctly (zero-padded)", () => {
    const result = formatDate("2024-01-05");
    expect(result).toBe("05.01.2024");
  });

  it("formats December 31 correctly", () => {
    const result = formatDate("2024-12-31");
    expect(result).toBe("31.12.2024");
  });
});

describe("formatDateTime", () => {
  it("includes date components in German format", () => {
    const result = formatDateTime("2024-06-15T10:30:00.000Z");
    // We can't assert exact time due to timezone, but date parts should be correct
    expect(result).toContain("2024");
    expect(result).toContain("06");
    expect(result).toContain("15");
  });

  it("returns a non-empty string for any valid ISO timestamp", () => {
    const result = formatDateTime("2025-01-01T00:00:00.000Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
