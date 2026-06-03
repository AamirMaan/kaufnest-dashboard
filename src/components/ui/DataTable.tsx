interface Column<T> {
  header: string;
  /** Key of T, or a custom render function */
  accessor?: keyof T;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

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
  const allIds = rows.map((r) => String(r[keyField]));
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
      className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)]"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
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
            {columns.map((col) => (
              <th
                key={col.header}
                className={`px-4 py-3 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider ${col.className ?? ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-surface)]">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={selectable ? columns.length + 1 : columns.length}
                className="px-4 py-10 text-center text-sm text-[var(--color-text-faint)]"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
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
  );
}
