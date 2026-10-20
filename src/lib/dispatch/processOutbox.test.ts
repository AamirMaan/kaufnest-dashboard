import { processOutbox, processOutboxUntilDrained, type ClaimedDispatchEmail, type OutboxDeps } from "./processOutbox";
import { buildDispatchEmail } from "@/lib/email/dispatchEmail";

jest.mock("@/lib/email/dispatchEmail", () => {
  const actual = jest.requireActual("@/lib/email/dispatchEmail");
  return { ...actual, buildDispatchEmail: jest.fn(actual.buildDispatchEmail) };
});

function row(over: Partial<ClaimedDispatchEmail> = {}): ClaimedDispatchEmail {
  return {
    outbox_id: "o1", sale_id: "s1", recipient_email: "sam@example.com", recipient_name: "Sam",
    recipient_active: true, recipient_can_view_orders: true, location_name: "Berlin", product_name: "Mug", quantity: 1,
    platform: "ebay", marketplace: null, external_order_id: null, order_date: "2026-10-19",
    buyer_name: null, shipping_address_line1: null, shipping_address_line2: null,
    shipping_city: null, shipping_state: null, shipping_postal_code: null, shipping_country: null,
    still_relevant: true,
    ...over,
  };
}

function deps(rows: ClaimedDispatchEmail[], send: OutboxDeps["send"] = jest.fn().mockResolvedValue(undefined)) {
  return {
    claim: jest.fn().mockResolvedValue(rows),
    markSent: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    send,
    appUrl: "https://app.example",
  };
}

describe("processOutbox", () => {
  it("sends each claimed row and marks it sent", async () => {
    const d = deps([row(), row({ outbox_id: "o2", sale_id: "s2" })]);
    await expect(processOutbox(d)).resolves.toEqual({ sent: 2, failed: 0, skipped: 0, sendFailed: false });
    expect(d.claim).toHaveBeenCalledWith(10);
    expect(d.send).toHaveBeenCalledTimes(2);
    expect((d.send as jest.Mock).mock.calls[0][0].to).toBe("sam@example.com");
    expect(d.markSent).toHaveBeenCalledWith("o1", null);
  });

  it("skips inactive recipients and missing emails without sending", async () => {
    const d = deps([row({ recipient_active: false }), row({ outbox_id: "o2", recipient_email: null })]);
    await expect(processOutbox(d)).resolves.toMatchObject({ sent: 0, failed: 0, skipped: 2 });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markSent).toHaveBeenCalledWith("o1", "skipped: recipient inactive");
    expect(d.markSent).toHaveBeenCalledWith("o2", "skipped: no email");
  });

  it("stops at the first failed send and releases the rows it never attempted", async () => {
    const send = jest.fn().mockRejectedValue(new Error("smtp down"));
    const d = deps([row(), row({ outbox_id: "o2" }), row({ outbox_id: "o3" })], send);
    await expect(processOutbox(d)).resolves.toEqual({ sent: 0, failed: 1, skipped: 0, sendFailed: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(d.markFailed).toHaveBeenCalledWith("o1", "smtp down");
    expect(d.release).toHaveBeenCalledWith(["o2", "o3"]);
    expect(d.markSent).not.toHaveBeenCalled();
  });

  it("does not release anything when the failed send was the last row", async () => {
    const d = deps([row()], jest.fn().mockRejectedValue(new Error("smtp down")));
    await processOutbox(d);
    expect(d.release).not.toHaveBeenCalled();
  });

  it("truncates long error messages", async () => {
    const send = jest.fn().mockRejectedValue(new Error("x".repeat(2000)));
    const d = deps([row()], send);
    await processOutbox(d);
    expect((d.markFailed as jest.Mock).mock.calls[0][1]).toHaveLength(500);
  });

  it("skips recipients who can no longer view Orders", async () => {
    const d = deps([row({ recipient_can_view_orders: false })]);
    await expect(processOutbox(d)).resolves.toMatchObject({ sent: 0, failed: 0, skipped: 1 });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markSent).toHaveBeenCalledWith("o1", "skipped: no orders access");
  });

  it("marks a row failed when building its email throws, and keeps going", async () => {
    (buildDispatchEmail as jest.Mock).mockImplementationOnce(() => {
      throw new Error("bad row");
    });
    const d = deps([row(), row({ outbox_id: "o2" })]);
    await expect(processOutbox(d)).resolves.toEqual({ sent: 1, failed: 1, skipped: 0, sendFailed: false });
    expect(d.markFailed).toHaveBeenCalledWith("o1", "bad row");
    expect(d.release).not.toHaveBeenCalled();
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.markSent).toHaveBeenCalledWith("o2", null);
  });

  it("skips rows that are no longer relevant (order closed or moved)", async () => {
    const d = deps([row({ still_relevant: false })]);
    await expect(processOutbox(d)).resolves.toMatchObject({ sent: 0, failed: 0, skipped: 1 });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markSent).toHaveBeenCalledWith("o1", "skipped: no longer relevant");
  });
});

describe("processOutboxUntilDrained", () => {
  const batch = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => row({ outbox_id: `${prefix}${i}`, sale_id: `${prefix}${i}` }));

  function drainDeps(batches: ClaimedDispatchEmail[][]) {
    const d = deps([]);
    d.claim = jest.fn().mockImplementation(async () => batches.shift() ?? []);
    return d;
  }

  it("stops after a short batch and aggregates counts", async () => {
    const d = drainDeps([batch(10, "a"), batch(3, "b")]);
    await expect(processOutboxUntilDrained(d, { maxBatches: 5, deadlineMs: 20_000, now: () => 0 })).resolves.toEqual({
      sent: 13, failed: 0, skipped: 0, batches: 2,
    });
    expect(d.claim).toHaveBeenCalledTimes(2);
    expect(d.claim).toHaveBeenCalledWith(10);
  });

  it("stops after an empty batch", async () => {
    const d = drainDeps([batch(10, "a"), []]);
    const r = await processOutboxUntilDrained(d, { maxBatches: 5, deadlineMs: 20_000, now: () => 0 });
    expect(r).toMatchObject({ sent: 10, batches: 2 });
  });

  it("is bounded by maxBatches", async () => {
    const d = drainDeps(Array.from({ length: 9 }, (_, i) => batch(10, `x${i}-`)));
    const r = await processOutboxUntilDrained(d, { maxBatches: 5, deadlineMs: 20_000, now: () => 0 });
    expect(r).toMatchObject({ sent: 50, batches: 5 });
    expect(d.claim).toHaveBeenCalledTimes(5);
  });

  it("is bounded by the wall-clock deadline", async () => {
    let t = 0;
    const now = () => t;
    const d = drainDeps(Array.from({ length: 9 }, (_, i) => batch(10, `x${i}-`)));
    const claim = d.claim as jest.Mock;
    const inner = claim.getMockImplementation()!;
    claim.mockImplementation(async (n: number) => { t += 8_000; return inner(n); });
    const r = await processOutboxUntilDrained(d, { maxBatches: 5, deadlineMs: 20_000, now });
    // starts at 0, 8 s, 16 s; the 4th claim would start at 24 s > 20 s.
    expect(r.batches).toBe(3);
  });

  it("stops after a batch with a failed send, so an SMTP outage can't burn every retry in one flush", async () => {
    // A claim that would hand back the rows it just failed (as an un-leased
    // outbox does): the loop must not keep re-claiming them.
    const rows = batch(10, "f");
    const d = deps([], jest.fn().mockRejectedValue(new Error("smtp down")));
    d.claim = jest.fn().mockResolvedValue(rows);
    const r = await processOutboxUntilDrained(d, { maxBatches: 5, deadlineMs: 20_000, now: () => 0 });
    expect(r).toMatchObject({ sent: 0, failed: 1, batches: 1 });
    expect(d.claim).toHaveBeenCalledTimes(1);
    expect(d.markFailed).toHaveBeenCalledTimes(1);
    expect(d.release).toHaveBeenCalledWith(rows.slice(1).map((x) => x.outbox_id));
  });
});
