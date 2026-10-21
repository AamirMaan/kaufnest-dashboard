/**
 * The "Sync eBay charges" success toast text. Mirrors the counters of
 * `ChargeSyncResult` (src/lib/integrations/ebay/chargeSync.ts) without
 * importing that server-only module. Pure — one sentence, then only the
 * non-zero notes.
 */
export type ChargeSyncCounts = Partial<Record<
  | "chargesImported" | "ordersFeesFilled" | "refundCreditsImported"
  | "skippedCurrency" | "skippedInvalid" | "nonFeeCreditsSkipped" | "currencyMismatch"
  | "ordersFeesNotWritten" | "orderLinkedAlreadyFilled" | "orderLinkedCreditsSkipped"
  | "orderLinkedUnmatched" | "refundCreditsSkipped",
  number
>>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const NOTES: [keyof ChargeSyncCounts, (n: number) => string][] = [
  ["skippedCurrency", (n) => `${n} in an unsupported currency`],
  ["skippedInvalid", (n) => `${n} with no usable amount`],
  ["nonFeeCreditsSkipped", (n) => plural(n, "credit that isn't a fee refund", "credits that aren't fee refunds")],
  ["currencyMismatch", (n) => `${n} in a different currency from its order`],
  ["ordersFeesNotWritten", (n) => plural(n, "fee not written (no Orders edit access or already filled)", "fees not written (no Orders edit access or already filled)")],
  ["orderLinkedAlreadyFilled", (n) => plural(n, "order fee already filled", "order fees already filled")],
  ["orderLinkedCreditsSkipped", (n) => plural(n, "order credit", "order credits")],
  ["orderLinkedUnmatched", (n) => plural(n, "order not imported yet", "orders not imported yet")],
  ["refundCreditsSkipped", (n) => plural(n, "refund credit for a returned, cancelled or not-imported order", "refund credits for returned, cancelled or not-imported orders")],
];

export function chargeSyncSummary(r: ChargeSyncCounts): string {
  const parts = [
    plural(r.chargesImported ?? 0, "new expense", "new expenses"),
    `${plural(r.ordersFeesFilled ?? 0, "order", "orders")} got fees`,
  ];
  if (r.refundCreditsImported) parts.push(plural(r.refundCreditsImported, "refund fee credit", "refund fee credits"));
  const sentence = `${parts.join(", ")}.`;
  const notes = NOTES.filter(([k]) => (r[k] ?? 0) > 0).map(([k, text]) => text(r[k] ?? 0));
  return notes.length ? `${sentence} Not applied: ${notes.join("; ")}.` : sentence;
}
