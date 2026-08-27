/**
 * WhatsApp-style day-separator label for a message timestamp. Uses the
 * viewer's own local time (not UTC) — a browser's local calendar day is
 * what a chat UI should group by, matching how WhatsApp itself behaves on a
 * user's device. German labels/short-date format match this app's existing
 * de-DE convention (lib/utils/date.ts), not WhatsApp's own English UI —
 * only the day-boundary/format PATTERN is borrowed, not the language.
 */
export function dayLabelFor(isoDate: string, now: Date = new Date()): string {
  const date = new Date(isoDate);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round(
    (startOfDay(now).getTime() - startOfDay(date).getTime()) / (24 * 60 * 60 * 1000)
  );

  if (dayDiff === 0) return "Heute";
  if (dayDiff === 1) return "Gestern";
  if (dayDiff > 1 && dayDiff < 7) {
    return date.toLocaleDateString("de-DE", { weekday: "long" });
  }
  return date.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "short" });
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
