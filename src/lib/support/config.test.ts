import { statusForList, listIdForStatus, parseStatusMap } from "./config";

describe("parseStatusMap", () => {
  it("parses a JSON list-id → status map", () => {
    expect(parseStatusMap('{"abc":"reported","def":"fixed"}')).toEqual({
      abc: "reported",
      def: "fixed",
    });
  });

  it("drops entries whose value is not a known status", () => {
    expect(parseStatusMap('{"abc":"reported","def":"nonsense"}')).toEqual({
      abc: "reported",
    });
  });

  it("returns an empty map for malformed JSON rather than throwing", () => {
    expect(parseStatusMap("not json")).toEqual({});
    expect(parseStatusMap(undefined)).toEqual({});
  });
});

describe("statusForList", () => {
  const map = { l1: "reported", l2: "fixed" } as const;

  it("maps a known list id to its status", () => {
    expect(statusForList("l2", { ...map })).toBe("fixed");
  });

  it("falls back to in_progress for an unknown list", () => {
    expect(statusForList("l9", { ...map })).toBe("in_progress");
  });
});

describe("listIdForStatus", () => {
  it("finds the first list mapped to a status", () => {
    expect(listIdForStatus("fixed", { l1: "reported", l2: "fixed" })).toBe("l2");
  });

  it("returns null when no list maps to that status", () => {
    expect(listIdForStatus("wont_fix", { l1: "reported" })).toBeNull();
  });
});
