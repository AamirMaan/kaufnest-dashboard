import { processOutbox, type ClaimedDispatchEmail, type OutboxDeps } from "./processOutbox";

function row(over: Partial<ClaimedDispatchEmail> = {}): ClaimedDispatchEmail {
  return {
    outbox_id: "o1", sale_id: "s1", recipient_email: "sam@example.com", recipient_name: "Sam",
    recipient_active: true, location_name: "Berlin", product_name: "Mug", quantity: 1,
    platform: "ebay", marketplace: null, external_order_id: null, order_date: "2026-10-19",
    buyer_name: null, shipping_address_line1: null, shipping_address_line2: null,
    shipping_city: null, shipping_state: null, shipping_postal_code: null, shipping_country: null,
    ...over,
  };
}

function deps(rows: ClaimedDispatchEmail[], send: OutboxDeps["send"] = jest.fn().mockResolvedValue(undefined)) {
  return {
    claim: jest.fn().mockResolvedValue(rows),
    markSent: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    send,
    appUrl: "https://app.example",
  };
}

describe("processOutbox", () => {
  it("sends each claimed row and marks it sent", async () => {
    const d = deps([row(), row({ outbox_id: "o2", sale_id: "s2" })]);
    await expect(processOutbox(d)).resolves.toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(d.claim).toHaveBeenCalledWith(50);
    expect(d.send).toHaveBeenCalledTimes(2);
    expect((d.send as jest.Mock).mock.calls[0][0].to).toBe("sam@example.com");
    expect(d.markSent).toHaveBeenCalledWith("o1", null);
  });

  it("skips inactive recipients and missing emails without sending", async () => {
    const d = deps([row({ recipient_active: false }), row({ outbox_id: "o2", recipient_email: null })]);
    await expect(processOutbox(d)).resolves.toEqual({ sent: 0, failed: 0, skipped: 2 });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markSent).toHaveBeenCalledWith("o1", "skipped: recipient inactive");
    expect(d.markSent).toHaveBeenCalledWith("o2", "skipped: no email");
  });

  it("records a failure and keeps going", async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error("smtp down")).mockResolvedValue(undefined);
    const d = deps([row(), row({ outbox_id: "o2" })], send);
    await expect(processOutbox(d)).resolves.toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect(d.markFailed).toHaveBeenCalledWith("o1", "smtp down");
    expect(d.markSent).toHaveBeenCalledWith("o2", null);
  });

  it("truncates long error messages", async () => {
    const send = jest.fn().mockRejectedValue(new Error("x".repeat(2000)));
    const d = deps([row()], send);
    await processOutbox(d);
    expect((d.markFailed as jest.Mock).mock.calls[0][1]).toHaveLength(500);
  });
});
