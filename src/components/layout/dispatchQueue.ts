/** One row of my_dispatch_queue() (057). */
export interface DispatchQueueRow {
  location_id: string;
  location_name: string;
  open_count: number;
}

/** Banner lines for DispatchBanner: one per location with open orders, linking to Orders filtered by it. */
export function dispatchBannerLines(rows: DispatchQueueRow[]) {
  return rows
    .filter((r) => r.open_count > 0)
    .map((r) => ({
      key: r.location_id,
      count: `${r.open_count} order${r.open_count === 1 ? "" : "s"}`,
      location: r.location_name,
      href: `/dashboard/sales?location=${encodeURIComponent(r.location_id)}`,
    }));
}
