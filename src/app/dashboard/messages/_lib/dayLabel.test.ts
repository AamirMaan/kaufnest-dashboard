import { dayLabelFor, isNewDay } from "./dayLabel";

// Both functions deliberately operate on the viewer's LOCAL calendar day
// (correct for a chat UI). Build fixtures from local date/time components,
// round-tripped through the same local<->UTC conversion the functions
// themselves perform via `new Date(iso)` — self-consistent on any machine,
// rather than hardcoding a UTC offset assumption a real ISO literal would
// silently bake in (setting process.env.TZ mid-file does NOT reliably work:
// Node's Date getters use timezone data cached at process start).
const local = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).toISOString();

const NOW = new Date(2026, 7, 27, 15, 0); // Aug 27 2026, 15:00 local

describe("dayLabelFor", () => {
  it("labels the same calendar day as Today", () => {
    expect(dayLabelFor(local(2026, 8, 27, 9), NOW)).toBe("Today");
  });

  it("labels the previous calendar day as Yesterday", () => {
    expect(dayLabelFor(local(2026, 8, 26, 23, 59), NOW)).toBe("Yesterday");
  });

  it("labels 2-6 days ago with the weekday name — English, matching the app's system language, not the buyer messages' German", () => {
    // 2026-08-24 is a Monday
    expect(dayLabelFor(local(2026, 8, 24, 9), NOW)).toBe("Monday");
  });

  it("labels 7+ days ago with a short date, not a weekday", () => {
    const label = dayLabelFor(local(2026, 8, 1, 9), NOW);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    expect(label).toMatch(/Aug/); // short month, en-US
  });

  it("does not crash on a timestamp slightly ahead of `now` (clock skew)", () => {
    expect(() => dayLabelFor(local(2026, 8, 27, 15, 1), NOW)).not.toThrow();
  });
});

describe("isNewDay", () => {
  it("is true for the first message in a thread (no previous)", () => {
    expect(isNewDay(local(2026, 8, 27, 9), null)).toBe(true);
  });

  it("is false for two messages on the same calendar day, even hours apart", () => {
    expect(isNewDay(local(2026, 8, 27, 23), local(2026, 8, 27, 1))).toBe(false);
  });

  it("is true across a calendar-day boundary, even if less than 24h apart", () => {
    expect(isNewDay(local(2026, 8, 28, 0, 1), local(2026, 8, 27, 23, 59))).toBe(true);
  });
});
