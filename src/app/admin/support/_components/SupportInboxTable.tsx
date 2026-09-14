"use client";

import { useMemo, useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils/date";
import { resolveDateRange, type DatePreset } from "@/lib/utils/filters";
import type { BugReport, BugReportStatus, BugSeverity } from "@/types";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

// Mirrors src/app/dashboard/support/_lib/groupReports.ts's STATUS_LABELS —
// duplicated rather than imported since `_lib`/`_components` are feature-
// private (see AGENTS.md's shared-vs-feature-private rule); this admin view
// only needs the labels, not the board-grouping logic.
const STATUS_LABELS: Record<BugReportStatus, string> = {
  reported: "Reported",
  in_progress: "In Progress",
  fixed: "Fixed",
  wont_fix: "Won't Fix",
};

const STATUS_VARIANT: Record<BugReportStatus, BadgeVariant> = {
  reported: "default",
  in_progress: "info",
  fixed: "success",
  wont_fix: "danger",
};

// Mirrors dashboard/support/_components/ReportCard.tsx's SEVERITY_VARIANT.
const SEVERITY_VARIANT: Record<BugSeverity, BadgeVariant> = {
  critical: "danger",
  high: "warning",
  normal: "info",
  low: "default",
};

const STATUS_OPTIONS: (BugReportStatus | "all")[] = ["all", "reported", "in_progress", "fixed", "wont_fix"];

const filterInputCls =
  "rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-(--color-text-strong) focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";

interface Filters {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  status: BugReportStatus | "all";
}

const DEFAULT_FILTERS: Filters = { preset: "all", dateFrom: "", dateTo: "", status: "all" };

function isDefaultFilters(f: Filters): boolean {
  return f.preset === "all" && f.dateFrom === "" && f.dateTo === "" && f.status === "all";
}

interface Props {
  reports: BugReport[];
  /** tenant id → slug, built by the server-component parent from control.tenants */
  tenantSlugs: Record<string, string>;
}

export function SupportInboxTable({ reports, tenantSlugs }: Props) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const hasActive = !isDefaultFilters(filters);

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  // All reports for every tenant are already on the page (server-fetched) —
  // filtering happens client-side rather than via a refetch, unlike the
  // server-side-paginated feature pages (Sales/Expenses/Audit Logs).
  const filtered = useMemo(() => {
    let result = reports;
    const range = resolveDateRange(filters.preset, filters.dateFrom, filters.dateTo);
    if (range) {
      result = result.filter((r) => {
        const day = r.created_at.slice(0, 10);
        return day >= range.from && day <= range.to;
      });
    }
    if (filters.status !== "all") {
      result = result.filter((r) => r.status === filters.status);
    }
    return result;
  }, [reports, filters]);

  const columns = [
    {
      header: "Tenant",
      render: (r: BugReport) => (
        <span className="font-mono text-xs text-(--color-text-muted)">
          {tenantSlugs[r.tenant_id] ?? "—"}
        </span>
      ),
    },
    {
      header: "Title",
      render: (r: BugReport) => (
        <span className="text-sm font-medium text-(--color-text-strong) line-clamp-1">{r.title}</span>
      ),
    },
    {
      header: "Type",
      render: (r: BugReport) => <Badge label={r.type} />,
    },
    {
      header: "Severity",
      render: (r: BugReport) => <Badge label={r.severity} variant={SEVERITY_VARIANT[r.severity]} />,
    },
    {
      header: "Status",
      render: (r: BugReport) => <Badge label={STATUS_LABELS[r.status]} variant={STATUS_VARIANT[r.status]} />,
    },
    {
      header: "Reporter",
      render: (r: BugReport) => <span className="text-sm text-(--color-text-muted)">{r.reporter_email}</span>,
    },
    {
      header: "Created",
      render: (r: BugReport) => (
        <span className="text-xs text-(--color-text-muted) whitespace-nowrap">
          {formatDateTime(r.created_at)}
        </span>
      ),
      sortValue: (r: BugReport) => r.created_at,
    },
    {
      header: "Trello",
      render: (r: BugReport) =>
        r.trello_card_url ? (
          <a
            href={r.trello_card_url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-(--color-primary) hover:underline"
          >
            View card
          </a>
        ) : (
          <Badge label="Not in Trello" variant="warning" />
        ),
    },
  ];

  return (
    <>
      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        hasActive={hasActive}
        onClear={() => setFilters(DEFAULT_FILTERS)}
      >
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-(--color-text-faint) mb-1">
            Status
          </span>
          <select
            value={filters.status}
            onChange={(e) => setFilter("status", e.target.value as BugReportStatus | "all")}
            className={filterInputCls}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All Statuses" : STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </FilterBar>

      <div className="mb-3 text-sm">
        <span className="text-(--color-text-muted)">
          {filtered.length} report{filtered.length !== 1 ? "s" : ""}
          {hasActive ? ` of ${reports.length}` : ""}
        </span>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        keyField="id"
        emptyMessage="No support reports match the current filters."
      />
    </>
  );
}
