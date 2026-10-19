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
}

export interface OutboxDeps {
  claim(limit: number): Promise<ClaimedDispatchEmail[]>;
  markSent(id: string, note: string | null): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<void>;
  appUrl: string;
}

const MAX_ERROR = 500;

/**
 * I/O-free core of the flush: claim → send → mark. Tested with fakes.
 * Small default batch: one flush request is triggered from a page load and
 * sends serially over one pooled SMTP connection.
 */
export async function processOutbox(deps: OutboxDeps, limit = 10) {
  const rows = await deps.claim(limit);
  let sent = 0, failed = 0, skipped = 0;

  for (const r of rows) {
    if (!r.recipient_active) { await deps.markSent(r.outbox_id, "skipped: recipient inactive"); skipped++; continue; }
    if (!r.recipient_can_view_orders) { await deps.markSent(r.outbox_id, "skipped: no orders access"); skipped++; continue; }
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
