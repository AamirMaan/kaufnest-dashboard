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
}

export function DataTable<T>({
  columns,
  rows,
  keyField,
  emptyMessage = "No records found.",
}: DataTableProps<T>) {
  return (
    <div
      className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)]"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <table className="min-w-full divide-y divide-[var(--color-border)]">
        <thead className="bg-[var(--color-surface-subtle)]">
          <tr>
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
                colSpan={columns.length}
                className="px-4 py-10 text-center text-sm text-[var(--color-text-faint)]"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={String(row[keyField])}
                className="hover:bg-[var(--color-surface-subtle)] transition-colors"
              >
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
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
