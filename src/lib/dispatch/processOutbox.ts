import { buildDispatchEmail } from "@/lib/email/dispatchEmail";

/** One row of the claim_dispatch_emails RPC (057). */
export interface ClaimedDispatchEmail {
  outbox_id: string;
  sale_id: string;
  recipient_email: string | null;
  recipient_name: string | null;
  recipient_active: boolean;
  /** Effective Orders access >= 1 at claim time (user_section_level, 057). */
  recipient_can_view_orders: boolean;
  location_name: string | null;
  product_name: string;
  quantity: number;
  platform: string;
  marketplace: string | null;
  external_order_id: string | null;
  order_date: string;
  buyer_name: string | null;
  shipping_address_line1: string | null;
  shipping_address_line2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  /**
   * Computed at claim time (057): the order is still pending/processing AND
   * its CURRENT fulfillment location's dispatcher is this row's recipient.
   * False when the order was closed or moved after the row was queued.
   */
  still_relevant: boolean;
}

export interface OutboxDeps {
  claim(limit: number): Promise<ClaimedDispatchEmail[]>;
  markSent(id: string, note: string | null): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<void>;
  appUrl: string;
}

const MAX_ERROR = 500;

export const OUTBOX_BATCH_SIZE = 10;

/**
 * I/O-free core of the flush: claim → send → mark. Tested with fakes.
 * Small batch: emails are sent serially; processOutboxUntilDrained loops.
 */
export async function processOutbox(deps: OutboxDeps, limit = OUTBOX_BATCH_SIZE) {
  const rows = await deps.claim(limit);
  let sent = 0, failed = 0, skipped = 0;

  for (const r of rows) {
    if (!r.recipient_active) { await deps.markSent(r.outbox_id, "skipped: recipient inactive"); skipped++; continue; }
    if (!r.recipient_can_view_orders) { await deps.markSent(r.outbox_id, "skipped: no orders access"); skipped++; continue; }
    if (!r.still_relevant) { await deps.markSent(r.outbox_id, "skipped: no longer relevant"); skipped++; continue; }
    if (!r.recipient_email) { await deps.markSent(r.outbox_id, "skipped: no email"); skipped++; continue; }
    const to = r.recipient_email;

    // Build inside the try: a throw for one row must not abort the batch and
    // strand the rest of the claimed rows until their lease expires.
    try {
      const msg = buildDispatchEmail({
        saleId: r.sale_id,
        productName: r.product_name,
        quantity: r.quantity,
        platform: r.platform,
        marketplace: r.marketplace,
        externalOrderId: r.external_order_id,
        orderDate: r.order_date,
        buyerName: r.buyer_name,
        address: [
          r.shipping_address_line1,
          r.shipping_address_line2,
          [r.shipping_postal_code, r.shipping_city, r.shipping_state].filter(Boolean).join(" ") || null,
          r.shipping_country,
        ],
        locationName: r.location_name ?? "your location",
        recipientName: r.recipient_name,
        appUrl: deps.appUrl,
      });
      await deps.send({ to, ...msg });
      await deps.markSent(r.outbox_id, null);
      sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await deps.markFailed(r.outbox_id, message.slice(0, MAX_ERROR));
      failed++;
    }
  }
  return { sent, failed, skipped };
}

/**
 * Claims batches until one comes back short (queue drained), bounded by
 * `maxBatches` AND a wall-clock `deadlineMs` (checked before each further
 * claim), whichever is hit first. `now` is injected for tests.
 */
export async function processOutboxUntilDrained(
  deps: OutboxDeps,
  opts: { maxBatches: number; deadlineMs: number; now?: () => number; batchSize?: number }
) {
  const now = opts.now ?? Date.now;
  const size = opts.batchSize ?? OUTBOX_BATCH_SIZE;
  const start = now();
  const total = { sent: 0, failed: 0, skipped: 0, batches: 0 };

  while (total.batches < opts.maxBatches) {
    if (total.batches > 0 && now() - start >= opts.deadlineMs) break;
    let claimed = 0;
    const counting: OutboxDeps = {
      ...deps,
      async claim(n) {
        const rows = await deps.claim(n);
        claimed = rows.length;
        return rows;
      },
    };
    const r = await processOutbox(counting, size);
    total.sent += r.sent;
    total.failed += r.failed;
    total.skipped += r.skipped;
    total.batches++;
    if (claimed < size) break;
  }
  return total;
}
