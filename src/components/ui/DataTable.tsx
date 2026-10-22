import { Fragment, useId, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronDown } from "lucide-react";
import { isTableExpandable, pruneIds, splitColumns, toggleId, totalColSpan } from "./dataTableColumns";

export interface Column<T> {
  header: string;
  /** Key of T, or a custom render function */
  accessor?: keyof T;
  render?: (row: T) => React.ReactNode;
  className?: string;
  /** When provided, the column header becomes clickable and rows can be sorted by this value */
  sortValue?: (row: T) => string | number;
  /** Render this column in the expanded row panel instead of the main row (its sortValue is ignored) */
  detail?: boolean;
}

type SortState = { key: string; direction: "asc" | "desc" } | null;

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyField: keyof T;
  emptyMessage?: string;
  /** When provided, renders a checkbox column and calls back with selected rows */
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Extra content rendered below the detail-field grid in the expanded panel */
  renderExpanded?: (row: T) => React.ReactNode;
  /** Return false to hide the chevron for a row with nothing to show (default: every row expandable) */
  isExpandable?: (row: T) => boolean;
}

function cellContent<T>(col: Column<T>, row: T): React.ReactNode {
  if (col.render) return col.render(row);
  if (col.accessor != null) return String(row[col.accessor] ?? "—");
  return null;
}

export function DataTable<T>({
  columns,
  rows,
  keyField,
  emptyMessage = "No records found.",
  selectedIds,
  onSelectionChange,
  renderExpanded,
  isExpandable,
}: DataTableProps<T>) {
  const selectable = !!onSelectionChange;
  const { inline, detail } = useMemo(() => splitColumns(columns), [columns]);
  const expandable = isTableExpandable(columns, !!renderExpanded);
  const colSpan = totalColSpan({ selectable, expandable, inlineCount: inline.length });
  const baseId = useId();

  const [sort, setSort] = useState<SortState>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = inline.find((c) => c.header === sort.key);
    if (!col?.sortValue) return rows;
    const { sortValue, direction } = { sortValue: col.sortValue, direction: sort.direction };
    return [...rows].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (av < bv) return direction === "asc" ? -1 : 1;
      if (av > bv) return direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, sort, inline]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }

  const allIds = sortedRows.map((r) => String(r[keyField]));
  const allSelected = selectable && allIds.length > 0 && allIds.every((id) => selectedIds?.has(id));

  // Drop open rows that left `rows` (page/filter change) during render, so
  // returning to a page shows it collapsed. pruneIds returns the same Set when
  // nothing left, so this settles after one extra render — no sync effect.
  const visibleExpandedIds = pruneIds(expandedIds, allIds);
  if (visibleExpandedIds !== expandedIds) setExpandedIds(visibleExpandedIds);

  function toggleRow(id: string) {
    setExpandedIds((prev) => toggleId(prev, id));
  }

  function toggleAll() {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(allIds));
    }
  }

  function toggleOne(id: string) {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  return (
    <div
      className="rounded-(--radius-card) border border-(--color-border) overflow-hidden"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-(--color-border)">
          <thead className="bg-(--color-surface-subtle)">
            <tr>
              {selectable && (
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="cursor-pointer accent-(--color-primary)"
                  />
                </th>
              )}
              {expandable && <th className="px-2 py-3 w-10" aria-label="Row details" />}
              {inline.map((col) => {
                const isSorted = sort?.key === col.header;
                const SortIcon = isSorted ? (sort!.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th
                    key={col.header}
                    className={`px-4 py-3 text-left text-xs font-semibold text-(--color-text-muted) uppercase tracking-wider ${col.className ?? ""}`}
                  >
                    {col.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.header)}
                        className="inline-flex items-center gap-1 cursor-pointer hover:text-(--color-text-strong) transition-colors duration-150"
                        title={`Sort by ${col.header}`}
                      >
                        {col.header}
                        <SortIcon size={12} className={isSorted ? "text-(--color-primary)" : "text-(--color-text-faint)"} />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-(--color-border-subtle) bg-(--color-surface)">
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-(--color-text-faint)">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => {
                const id = String(row[keyField]);
                const isSelected = selectedIds?.has(id) ?? false;
                const canExpand = expandable && (isExpandable?.(row) ?? true);
                const isOpen = canExpand && expandedIds.has(id);
                const panelId = `${baseId}-detail-${id}`;
                return (
                  <Fragment key={id}>
                    <tr
                      className={`hover:bg-(--color-surface-subtle) transition-colors duration-150 ${isSelected ? "bg-(--color-info-bg)" : ""}`}
                    >
                      {selectable && (
                        <td className="px-4 py-3 w-10">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(id)}
                            className="cursor-pointer accent-(--color-primary)"
                          />
                        </td>
                      )}
                      {expandable && (
                        <td className="px-2 py-3 w-10">
                          {canExpand && (
                            <button
                              type="button"
                              onClick={() => toggleRow(id)}
                              aria-expanded={isOpen}
                              aria-controls={isOpen ? panelId : undefined}
                              aria-label={isOpen ? "Collapse row" : "Expand row"}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-(--radius-btn) text-(--color-text-muted) hover:bg-(--color-border-subtle) hover:text-(--color-text-strong) cursor-pointer transition-colors duration-150"
                            >
                              <ChevronDown
                                size={16}
                                className={`transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
                              />
                            </button>
                          )}
                        </td>
                      )}
                      {inline.map((col) => (
                        <td key={col.header} className={`px-4 py-3 ${col.className ?? ""}`}>
                          {cellContent(col, row)}
                        </td>
                      ))}
                    </tr>
                    {isOpen && (
                      <tr id={panelId} className="bg-(--color-surface-subtle) border-t-2 border-(--color-border-subtle)">
                        <td colSpan={colSpan} className="px-6 py-5">
                          {detail.length > 0 && (
                            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5">
                              {detail.map((col) => (
                                <div key={col.header} className="min-w-0">
                                  <dt className="text-sm font-semibold text-(--color-text-strong)">{col.header}</dt>
                                  <dd className="mt-1 text-sm text-(--color-text-muted)">{cellContent(col, row)}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                          {renderExpanded && (
                            <div className={detail.length > 0 ? "mt-4" : ""}>{renderExpanded(row)}</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
