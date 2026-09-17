import { fetchEarliestYear } from "./fetchEarliestYear";

describe("fetchEarliestYear", () => {
  it("returns the year from the fetched earliest date", async () => {
    const year = await fetchEarliestYear(async () => "2019-03-15");
    expect(year).toBe(2019);
  });

  it("works with a full ISO timestamp (e.g. audit_logs.created_at)", async () => {
    const year = await fetchEarliestYear(async () => "2021-07-01T10:23:00+00:00");
    expect(year).toBe(2021);
  });

  it("returns the given fallback when no date is found", async () => {
    const year = await fetchEarliestYear(async () => null, 2020);
    expect(year).toBe(2020);
  });

  it("defaults the fallback to the current year when not given", async () => {
    const year = await fetchEarliestYear(async () => null);
    expect(year).toBe(new Date().getFullYear());
  });

  it("falls back on an unparseable date string", async () => {
    const year = await fetchEarliestYear(async () => "not-a-date", 2020);
    expect(year).toBe(2020);
  });
});
