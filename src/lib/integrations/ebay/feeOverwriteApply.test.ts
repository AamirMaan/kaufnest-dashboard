import { FEE_OVERWRITE_MAX_CHANGES } from "@/lib/utils/feeOverwriteAccess";
import { parseFeeOverwriteApply } from "./feeOverwriteApply";

const SALE = "8f14e45f-ceea-467a-9b36-2f3c1c6d2e10";
const good = { connectionId: "conn-1", changes: [{ saleId: SALE, field: "platform_fee", from: 2, to: 1.2 }] };

describe("parseFeeOverwriteApply", () => {
  it("accepts a valid payload (from may be null)", () => {
    const body = { ...good, changes: [...good.changes, { saleId: SALE, field: "advertising_fee", from: null, to: 0 }] };
    expect(parseFeeOverwriteApply(body)).toEqual({ ok: true, connectionId: "conn-1", changes: body.changes });
  });

  it.each([
    ["no body", null],
    ["no connectionId", { changes: good.changes }],
    ["empty changes", { connectionId: "c", changes: [] }],
    ["bad field", { connectionId: "c", changes: [{ saleId: SALE, field: "shipping_cost", from: null, to: 1 }] }],
    ["negative to", { connectionId: "c", changes: [{ saleId: SALE, field: "platform_fee", from: null, to: -1 }] }],
    ["non-finite to", { connectionId: "c", changes: [{ saleId: SALE, field: "platform_fee", from: null, to: "1" }] }],
    ["bad from", { connectionId: "c", changes: [{ saleId: SALE, field: "platform_fee", from: "x", to: 1 }] }],
    ["bad saleId", { connectionId: "c", changes: [{ saleId: "nope", field: "platform_fee", from: null, to: 1 }] }],
    ["duplicate sale+field", { connectionId: "c", changes: [good.changes[0], good.changes[0]] }],
  ])("rejects %s", (_name, body) => {
    expect(parseFeeOverwriteApply(body).ok).toBe(false);
  });

  it("rejects more than FEE_OVERWRITE_MAX_CHANGES", () => {
    const changes = Array.from({ length: FEE_OVERWRITE_MAX_CHANGES + 1 }, (_, i) => ({
      saleId: `8f14e45f-ceea-467a-9b36-${String(i).padStart(12, "0")}`, field: "platform_fee", from: null, to: 1,
    }));
    expect(parseFeeOverwriteApply({ connectionId: "c", changes }).ok).toBe(false);
  });
});
