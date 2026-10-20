/**
 * Pure builder for the "order to dispatch" email (057). No I/O — the outbox
 * flusher (`lib/dispatch/flushOutbox.ts`) feeds it a claimed outbox row.
 * Every interpolated value goes through escapeHtml in the html part.
 */
export interface DispatchEmailInput {
  saleId: string;
  productName: string;
  quantity: number;
  platform: string;
  marketplace: string | null;
  externalOrderId: string | null;
  orderDate: string;
  buyerName: string | null;
  /** Address lines in display order; null/blank entries are dropped. */
  address: (string | null)[];
  locationName: string;
  recipientName: string | null;
  appUrl: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildDispatchEmail(i: DispatchEmailInput): { subject: string; html: string; text: string } {
  const link = `${i.appUrl.replace(/\/+$/, "")}/dashboard/sales/${encodeURIComponent(i.saleId)}`;
  const greeting = i.recipientName ? `Hi ${i.recipientName},` : "Hi,";
  const channel = i.marketplace ?? i.platform;
  const shipTo = [i.buyerName, ...i.address].filter((l): l is string => !!l && l.trim() !== "");

  const rows: [string, string][] = [
    ["Item", `${i.quantity} × ${i.productName}`],
    ["From", i.locationName],
    ["Channel", channel],
    ...(i.externalOrderId ? ([["Order", i.externalOrderId]] as [string, string][]) : []),
    ["Order date", i.orderDate],
  ];

  const subject = `Dispatch needed: ${i.quantity} × ${i.productName} (${i.locationName})`;

  const text = [
    greeting,
    "",
    `A new order is ready to dispatch from ${i.locationName}.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(shipTo.length ? ["", "Ship to:", ...shipTo] : []),
    "",
    `Open the order: ${link}`,
  ].join("\n");

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
<p>${escapeHtml(greeting)}</p>
<p>A new order is ready to dispatch from <strong>${escapeHtml(i.locationName)}</strong>.</p>
<table cellpadding="4" style="border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="color:#555">${escapeHtml(k)}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`)
    .join("")}</table>
${shipTo.length ? `<p style="margin-top:16px"><span style="color:#555">Ship to</span><br>${shipTo.map(escapeHtml).join("<br>")}</p>` : ""}
<p style="margin-top:24px"><a href="${escapeHtml(link)}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open order</a></p>
</body></html>`;

  return { subject, html, text };
}
