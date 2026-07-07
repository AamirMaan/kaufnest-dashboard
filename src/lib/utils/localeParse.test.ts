import { parseLocaleNumber, parseFlexibleDate } from "./localeParse";

describe("parseLocaleNumber", () => {
  it.each<[string, number]>([
    ["1.234,56", 1234.56], // German thousands + decimal comma
    ["9,99", 9.99], // decimal comma
    ["1,234.56", 1234.56], // English thousands + decimal point
    ["1.234", 1234], // German thousands (exact grouping)
    ["12.345.678", 12345678], // multiple German thousands groups
    ["1,234,567", 1234567], // multiple English thousands groups
    ["9.99", 9.99], // plain decimal point
    ["0,5", 0.5],
    ["-3,5", -3.5],
    ["+2,50", 2.5],
    ["€ 12,50", 12.5], // currency symbol + space
    ["$1,234.56", 1234.56],
    ["19", 19],
    ["0", 0],
    ["12,3456", 12.3456], // single comma is always decimal
  ])("%s → %d", (input, expected) => {
    expect(parseLocaleNumber(input)).toBe(expected);
  });

  it.each<[string]>([
    [""],
    ["   "],
    ["abc"],
    ["N/A"],
    ["1.23.45"], // dots, not a grouping pattern
    ["1,23,45"], // commas, not a grouping pattern
  ])("unparseable %s → null", (input) => {
    expect(parseLocaleNumber(input)).toBeNull();
  });

  it("undefined → null", () => {
    expect(parseLocaleNumber(undefined)).toBeNull();
  });
});

describe("parseFlexibleDate", () => {
  it.each<[string, string]>([
    ["2024-01-15", "2024-01-15"],
    ["15.01.2024", "2024-01-15"],
    ["1.2.2024", "2024-02-01"],
    ["15/01/2024", "2024-01-15"],
    ["26-03-2026", "2026-03-26"], // dash separator (DD-MM-YYYY)
    ["1-2-2024", "2024-02-01"],   // dash separator, single-digit day/month
    ["29.02.2024", "2024-02-29"], // leap year
  ])("%s → %s", (input, expected) => {
    expect(parseFlexibleDate(input)).toBe(expected);
  });

  it.each<[string]>([
    [""],
    ["not a date"],
    ["31.02.2024"], // no Feb 31
    ["29.02.2023"], // not a leap year
    ["15.01.24"], // two-digit year rejected (I7)
    ["2024-1-15"], // ISO must be zero-padded
    ["32.01.2024"],
    ["15.13.2024"],
  ])("invalid %s → null", (input) => {
    expect(parseFlexibleDate(input)).toBeNull();
  });

  it("undefined → null", () => {
    expect(parseFlexibleDate(undefined)).toBeNull();
  });
});
