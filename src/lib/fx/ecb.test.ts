import { parseEcbCsv } from "./ecb";

describe("parseEcbCsv", () => {
  it("extracts the OBS_VALUE for the requested date", () => {
    const csv = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n" +
      "D.SEK.EUR.SP00.A,D,SEK,EUR,SP00,A,2026-05-29,11.4123";
    expect(parseEcbCsv(csv, "2026-05-29")).toBe(11.4123);
  });

  it("returns null when the CSV has no data row (no publication that day)", () => {
    const csv = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE";
    expect(parseEcbCsv(csv, "2026-05-30")).toBeNull();
  });

  it("returns null when the requested date isn't in the response", () => {
    const csv = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n" +
      "D.SEK.EUR.SP00.A,D,SEK,EUR,SP00,A,2026-05-28,11.40";
    expect(parseEcbCsv(csv, "2026-05-29")).toBeNull();
  });

  it("throws when the CSV is missing expected columns (unexpected API shape change)", () => {
    const csv = "SOME,OTHER,SHAPE\n1,2,3";
    expect(() => parseEcbCsv(csv, "2026-05-29")).toThrow();
  });
});
