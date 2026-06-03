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
});

describe("formatDate", () => {
  it("formats an ISO date to German dd.mm.yyyy format", () => {
    const result = formatDate("2024-06-15");
    expect(result).toBe("15.06.2024");
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
});
