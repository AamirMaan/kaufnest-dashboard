import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

interface Column<T> {
  header: string;
  /** Key of T, or a custom render function */
  accessor?: keyof T;
  render?: (row: T) => React.ReactNode;
  className?: string;
  /** When provided, the column header becomes clickable and rows can be sorted by this value */
  sortValue?: (row: T) => string | number;
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
}

export function DataTable<T>({
  columns,
  rows,
  keyField,
  emptyMessage = "No records found.",
  selectedIds,
  onSelectionChange,
}: DataTableProps<T>) {
  const selectable = !!onSelectionChange;

  const [sort, setSort] = useState<SortState>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.header === sort.key);
    if (!col?.sortValue) return rows;
    const { sortValue, direction } = { sortValue: col.sortValue, direction: sort.direction };
    return [...rows].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (av < bv) return direction === "asc" ? -1 : 1;
      if (av > bv) return direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, sort, columns]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }

  const allIds = sortedRows.map((r) => String(r[keyField]));
  const allSelected = selectable && allIds.length > 0 && allIds.every((id) => selectedIds?.has(id));

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
      className="rounded-[var(--radius-card)] border border-[var(--color-border)] overflow-hidden"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-[var(--color-border)]">
        <thead className="bg-[var(--color-surface-subtle)]">
          <tr>
            {selectable && (
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="cursor-pointer accent-[var(--color-primary)]"
                />
              </th>
            )}
            {columns.map((col) => {
              const isSorted = sort?.key === col.header;
              const SortIcon = isSorted ? (sort!.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th
                  key={col.header}
                  className={`px-4 py-3 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider ${col.className ?? ""}`}
                >
                  {col.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.header)}
                      className="inline-flex items-center gap-1 cursor-pointer hover:text-[var(--color-text-strong)] transition-colors"
                      title={`Sort by ${col.header}`}
                    >
                      {col.header}
                      <SortIcon size={12} className={isSorted ? "text-[var(--color-primary)]" : "text-[var(--color-text-faint)]"} />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-surface)]">
          {sortedRows.length === 0 ? (
            <tr>
              <td
                colSpan={selectable ? columns.length + 1 : columns.length}
                className="px-4 py-10 text-center text-sm text-[var(--color-text-faint)]"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedRows.map((row) => {
              const id = String(row[keyField]);
              const isSelected = selectedIds?.has(id) ?? false;
              return (
                <tr
                  key={id}
                  className={`hover:bg-[var(--color-surface-subtle)] transition-colors ${isSelected ? "bg-[var(--color-info-bg)]" : ""}`}
                >
                  {selectable && (
                    <td className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(id)}
                        className="cursor-pointer accent-[var(--color-primary)]"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.header} className={`px-4 py-3 ${col.className ?? ""}`}>
                      {col.render
                        ? col.render(row)
                        : col.accessor != null
                        ? String(row[col.accessor] ?? "—")
                        : null}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
