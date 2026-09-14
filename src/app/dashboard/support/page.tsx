"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchReports, selectReport } from "./_store/supportSlice";
import { groupByStatus, STATUS_COLUMNS, STATUS_LABELS, STATUS_EMPTY_MESSAGES } from "./_lib/groupReports";
import { ReportCard } from "./_components/ReportCard";
import { ReportDetailPanel } from "./_components/ReportDetailPanel";
import type { BugReportStatus } from "@/types";

const filterInputCls =
  "rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";

export default function SupportPage() {
  const dispatch = useAppDispatch();
  const items = useAppSelector((s) => s.support.items);
  const loaded = useAppSelector((s) => s.support.loaded);
  const isFetching = useAppSelector((s) => s.support.isFetching);
  const error = useAppSelector((s) => s.support.error);
  const selectedId = useAppSelector((s) => s.support.selectedId);

  const [mobileFilter, setMobileFilter] = useState<BugReportStatus>("reported");

  useEffect(() => {
    dispatch(fetchReports());
  }, [dispatch]);

  const grouped = useMemo(() => groupByStatus(items), [items]);
  const selectedReport = items.find((r) => r.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Support"
        description="Bugs, feature requests, and questions you've reported"
        action={
          <Button>
            <Plus size={15} />
            Report an issue
            {/* TODO: wire in Task 13 (ReportIssueModal) */}
          </Button>
        }
      />

      {isFetching && !loaded && (
        <div className="flex items-center gap-2 py-12 justify-center text-sm text-(--color-text-muted)">
          <Loader2 size={16} className="animate-spin" />
          Loading reports…
        </div>
      )}

      {error && (
        <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)] mb-6">
          {error}
        </div>
      )}

      {loaded && (
        <>
          {/* Board — four status columns, md and up */}
          <div className="hidden md:grid md:grid-cols-4 gap-4">
            {STATUS_COLUMNS.map((status) => (
              <div key={status}>
                <h2 className="text-sm font-semibold text-(--color-text-strong) mb-2">
                  {STATUS_LABELS[status]}
                  <span className="ml-1.5 text-xs font-normal text-(--color-text-faint)">
                    ({grouped[status].length})
                  </span>
                </h2>
                <div className="space-y-2">
                  {grouped[status].length === 0 ? (
                    <p className="text-xs text-(--color-text-muted) py-4 text-center">
                      {STATUS_EMPTY_MESSAGES[status]}
                    </p>
                  ) : (
                    grouped[status].map((report) => (
                      <ReportCard
                        key={report.id}
                        report={report}
                        onOpen={() => dispatch(selectReport(report.id))}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Single filtered list, below md */}
          <div className="md:hidden">
            <select
              value={mobileFilter}
              onChange={(e) => setMobileFilter(e.target.value as BugReportStatus)}
              className={`${filterInputCls} mb-3 w-full`}
            >
              {STATUS_COLUMNS.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]} ({grouped[status].length})
                </option>
              ))}
            </select>
            <div className="space-y-2">
              {grouped[mobileFilter].length === 0 ? (
                <p className="text-sm text-(--color-text-muted) py-8 text-center">
                  {STATUS_EMPTY_MESSAGES[mobileFilter]}
                </p>
              ) : (
                grouped[mobileFilter].map((report) => (
                  <ReportCard
                    key={report.id}
                    report={report}
                    onOpen={() => dispatch(selectReport(report.id))}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}

      <ReportDetailPanel report={selectedReport} onClose={() => dispatch(selectReport(null))} />
    </div>
  );
}
