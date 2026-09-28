import { ChevronDown } from "lucide-react";

// ─── Pure helpers — exported for unit testing ─────────────────────────────────

/**
 * Returns the "Showing X–Y of Z" label for a paginated result set.
 * page is 1-indexed. Returns "Showing 0–0 of 0" when total is 0.
 */
export function pageRangeLabel(page: number, pageSize: number, total: number): string {
  if (total === 0) return "Showing 0–0 of 0";
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return `Showing ${from}–${to} of ${total}`;
}

/** Most page buttons shown before the list collapses with "…" gaps. */
const MAX_PAGE_BUTTONS = 7;

/**
 * Page buttons to render: every page when there are ≤ 7, otherwise the
 * first, last, current ±1 and "…" gaps — always 7 slots so the footer
 * doesn't jump width as you page. page is 1-indexed.
 */
export function pageNumbers(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= MAX_PAGE_BUTTONS) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  if (page <= 4) return [1, 2, 3, 4, 5, "…", totalPages];
  if (page >= totalPages - 3) {
    return [1, "…", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "…", page - 1, page, page + 1, "…", totalPages];
}

// ─── Component ────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

const pillCls =
  "inline-flex h-9 items-center justify-center rounded-[var(--radius-btn)] border text-sm font-medium transition-colors";
const navCls =
  `${pillCls} px-3.5 border-(--color-border) bg-(--color-surface) text-(--color-text-strong) hover:bg-(--color-surface-subtle) cursor-pointer disabled:cursor-not-allowed disabled:bg-(--color-surface-subtle) disabled:text-(--color-text-faint) disabled:hover:bg-(--color-surface-subtle)`;

export interface PaginationProps {
  page: number;                                  // 1-indexed current page
  pageSize: number;                              // rows per page
  total: number;                                 // total rows matching filters
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isFirst = page <= 1;
  const isLast = page >= totalPages;

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-sm text-(--color-text-muted)"
    >
      {/* Left: row-range label */}
      <span className="tabular-nums">
        {pageRangeLabel(page, pageSize, total)} results
      </span>

      {/* Right: page-size select + Previous / page numbers / Next */}
      <div className="flex flex-wrap items-center gap-3">
        {onPageSizeChange && (
          <label className="flex items-center gap-2">
            <span>Rows</span>
            <span className="relative">
              <select
                value={pageSize}
                onChange={(e) => {
                  onPageSizeChange(Number(e.target.value));
                  onPageChange(1); // reset to page 1 on size change
                }}
                className="h-9 appearance-none rounded-[var(--radius-btn)] border border-(--color-border) bg-(--color-surface) pl-3 pr-8 text-sm text-(--color-text-strong) focus:outline-none focus:ring-2 focus:ring-(--color-primary) cursor-pointer"
              >
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                aria-hidden
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-(--color-text-muted)"
              />
            </span>
          </label>
        )}

        <div className="flex items-center gap-1.5">
          <button type="button" className={navCls} onClick={() => onPageChange(page - 1)} disabled={isFirst}>
            Previous
          </button>

          {pageNumbers(page, totalPages).map((n, i) =>
            n === "…" ? (
              <span key={`gap-${i}`} aria-hidden className="w-6 text-center text-(--color-text-faint)">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                onClick={() => onPageChange(n)}
                aria-label={`Page ${n}`}
                aria-current={n === page ? "page" : undefined}
                className={`${pillCls} min-w-9 px-2 tabular-nums cursor-pointer ${
                  n === page
                    ? "border-(--color-primary) bg-(--color-primary) text-white"
                    : "border-(--color-border) bg-(--color-surface) text-(--color-text-strong) hover:bg-(--color-surface-subtle)"
                }`}
              >
                {n}
              </button>
            )
          )}

          <button type="button" className={navCls} onClick={() => onPageChange(page + 1)} disabled={isLast}>
            Next
          </button>
        </div>
      </div>
    </nav>
  );
}
