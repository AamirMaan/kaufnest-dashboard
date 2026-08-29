import { isTrialExpired } from "./trial";

describe("isTrialExpired", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");

  it("is false for a non-trial plan even with a past trial_ends_at", () => {
    expect(isTrialExpired("pro", "2020-01-01T00:00:00.000Z", now)).toBe(false);
    expect(isTrialExpired("business", "2020-01-01T00:00:00.000Z", now)).toBe(false);
    expect(isTrialExpired("starter", "2020-01-01T00:00:00.000Z", now)).toBe(false);
  });

  it("is false for a trial that has not reached its end date", () => {
    expect(isTrialExpired("trial", "2026-09-11T12:00:00.000Z", now)).toBe(false);
  });

  it("is true for a trial whose end date has passed", () => {
    expect(isTrialExpired("trial", "2026-08-27T12:00:00.000Z", now)).toBe(true);
  });

  it("treats the exact expiry instant as expired", () => {
    expect(isTrialExpired("trial", "2026-08-28T12:00:00.000Z", now)).toBe(true);
  });

  // Fail-open, matching proxy.ts's existing posture: a missing date must not
  // lock a paying-in-progress tenant out of their own dashboard.
  it("is false when trial_ends_at is null", () => {
    expect(isTrialExpired("trial", null, now)).toBe(false);
  });

  it("is false when trial_ends_at is unparseable", () => {
    expect(isTrialExpired("trial", "not-a-date", now)).toBe(false);
  });
});
