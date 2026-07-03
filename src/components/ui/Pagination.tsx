import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./Button";

// ─── Pure helper — exported for unit testing ──────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

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
    <div className="flex items-center justify-between gap-4 px-1 py-2 text-sm text-(--color-text-muted)">
      {/* Left: row-range label */}
      <span className="tabular-nums">
        {pageRangeLabel(page, pageSize, total)}
      </span>

      {/* Right: page-size select + prev/next */}
      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <span className="text-xs">Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1); // reset to page 1 on size change
              }}
              className="rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface) px-2 py-1 text-xs text-(--color-text-base) focus:outline-none focus:ring-1 focus:ring-(--color-primary) cursor-pointer"
            >
              {PAGE_SIZE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onPageChange(page - 1)}
            disabled={isFirst}
            aria-label="Previous page"
            title="Previous page"
          >
            <ChevronLeft size={14} />
          </Button>

          <span className="tabular-nums text-xs px-1">
            {page} / {totalPages}
          </span>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onPageChange(page + 1)}
            disabled={isLast}
            aria-label="Next page"
            title="Next page"
          >
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
