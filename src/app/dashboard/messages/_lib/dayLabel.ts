/**
 * WhatsApp-style day-separator label for a message timestamp. Uses the
 * viewer's own local time (not UTC) — a browser's local calendar day is
 * what a chat UI should group by, matching how WhatsApp itself behaves on a
 * user's device. English labels, matching this app's system/UI language —
 * NOT the buyer message content's language (German, since these are German
 * eBay marketplace conversations) and NOT `lib/utils/date.ts`'s de-DE
 * choice for `formatDate`/`formatDateTime`, which is a separate, existing
 * decision this file doesn't touch. Only the day-boundary/format PATTERN is
 * borrowed from WhatsApp, not its locale.
 */
export function dayLabelFor(isoDate: string, now: Date = new Date()): string {
  const date = new Date(isoDate);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round(
    (startOfDay(now).getTime() - startOfDay(date).getTime()) / (24 * 60 * 60 * 1000)
  );

  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff > 1 && dayDiff < 7) {
    return date.toLocaleDateString("en-US", { weekday: "long" });
  }
  return date.toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "short" });
}

/** True when `isoDate` falls on a different local calendar day than `previousIsoDate` (or there is none). */
export function isNewDay(isoDate: string, previousIsoDate: string | null): boolean {
  if (previousIsoDate === null) return true;
  const a = new Date(isoDate);
  const b = new Date(previousIsoDate);
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
}
