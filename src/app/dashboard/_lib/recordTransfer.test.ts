import { isTransferFormValid, transferInsertPayload, type TransferForm } from "./recordTransfer";

const form = (over: Partial<TransferForm> = {}): TransferForm => ({
  platform: "ebay", currency: "EUR", amount: "100.00", date: "2026-10-08", notes: "", ...over,
});

describe("isTransferFormValid", () => {
  it("accepts a complete form", () => {
    expect(isTransferFormValid(form())).toBe(true);
  });
  it("requires a platform", () => {
    expect(isTransferFormValid(form({ platform: "" }))).toBe(false);
  });
  it("requires a positive amount", () => {
    expect(isTransferFormValid(form({ amount: "" }))).toBe(false);
    expect(isTransferFormValid(form({ amount: "0" }))).toBe(false);
    expect(isTransferFormValid(form({ amount: "-5" }))).toBe(false);
    expect(isTransferFormValid(form({ amount: "abc" }))).toBe(false);
  });
  it("requires a date", () => {
    expect(isTransferFormValid(form({ date: "" }))).toBe(false);
  });
});

describe("transferInsertPayload", () => {
  it("parses the amount, trims notes and stamps the user", () => {
    expect(transferInsertPayload(form({ amount: "12.5", notes: "  ref 42 " }), "u1")).toEqual({
      platform: "ebay", amount: 12.5, currency: "EUR", date: "2026-10-08", notes: "ref 42", created_by: "u1",
    });
  });
  it("stores blank notes as null", () => {
    expect(transferInsertPayload(form({ notes: "   " }), "u1").notes).toBeNull();
  });
  it("throws on an invalid form rather than inserting garbage", () => {
    expect(() => transferInsertPayload(form({ platform: "" }), "u1")).toThrow();
  });
});
