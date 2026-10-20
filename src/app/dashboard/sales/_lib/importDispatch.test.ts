import { IMPORT_DISPATCH_FIELDS, isMissingDispatchColumn, withoutDispatchFields } from "./importDispatch";

describe("IMPORT_DISPATCH_FIELDS", () => {
  it("always suppresses dispatch notifications for CSV imports", () => {
    expect(IMPORT_DISPATCH_FIELDS).toEqual({ dispatch_suppressed: true });
  });
});

describe("isMissingDispatchColumn", () => {
  it("matches PostgREST's unknown-column error for dispatch_suppressed (pre-057)", () => {
    expect(isMissingDispatchColumn({
      code: "PGRST204",
      message: "Could not find the 'dispatch_suppressed' column of 'sales' in the schema cache",
    })).toBe(true);
  });

  it("does not match other errors, other columns, or no error", () => {
    expect(isMissingDispatchColumn(null)).toBe(false);
    expect(isMissingDispatchColumn({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isMissingDispatchColumn({ code: "PGRST204", message: "Could not find the 'marketplace' column" })).toBe(false);
  });
});

describe("withoutDispatchFields", () => {
  it("drops only the dispatch_suppressed key", () => {
    expect(withoutDispatchFields([{ a: 1, dispatch_suppressed: true }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
  });
});
