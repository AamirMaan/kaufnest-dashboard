/**
 * Format an ISO date string to German locale short date.
 * e.g. "2024-06-01" → "01.06.2024"
 */
export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Format an ISO timestamp to German locale date + time.
 * e.g. "2024-06-01T14:30:00Z" → "01.06.2024, 16:30 Uhr"
 */
export function formatDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Return the first and last ISO date of a given month.
 * Uses local-date construction to avoid UTC offset shifts.
 */
export function getMonthRange(year: number, month: number): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(lastDay)}`;
  return { from, to };
}
