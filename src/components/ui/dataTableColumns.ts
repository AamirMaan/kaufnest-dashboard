/**
 * Pure helpers behind DataTable's expandable-row mode. Columns flagged
 * `detail: true` render in a chevron-revealed panel instead of the main row.
 */

export function splitColumns<C extends { detail?: boolean }>(columns: C[]): { inline: C[]; detail: C[] } {
  const inline: C[] = [];
  const detail: C[] = [];
  for (const col of columns) (col.detail ? detail : inline).push(col);
  return { inline, detail };
}

export function isTableExpandable(columns: { detail?: boolean }[], hasRenderExpanded: boolean): boolean {
  return hasRenderExpanded || columns.some((c) => c.detail);
}

export function toggleId(ids: Set<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Drops ids not in `presentIds`; returns `ids` itself when nothing was dropped. */
export function pruneIds(ids: Set<string>, presentIds: Iterable<string>): Set<string> {
  const present = new Set(presentIds);
  let removed = false;
  const next = new Set<string>();
  for (const id of ids) {
    if (present.has(id)) next.add(id);
    else removed = true;
  }
  return removed ? next : ids;
}

export function totalColSpan({
  selectable,
  expandable,
  inlineCount,
}: {
  selectable: boolean;
  expandable: boolean;
  inlineCount: number;
}): number {
  return inlineCount + (selectable ? 1 : 0) + (expandable ? 1 : 0);
}
