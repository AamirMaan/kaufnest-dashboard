"use client";

import { useState, useCallback, useEffect } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { fetchAuditLogsPage } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { Pagination } from "@/components/ui/Pagination";
import { ActionBadge } from "@/components/ui/Badge";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AuditLogDetailModal } from "./_components/AuditLogDetailModal";
import { formatDateTime } from "@/lib/utils/date";
import {
  isDefaultAuditLogFilters,
  DEFAULT_AUDIT_LOG_FILTERS,
  type AuditLogFilters,
  type DatePreset,
} from "@/lib/utils/filters";
import type { AuditLog, AuditAction } from "@/types";
import { createTenantClient } from "@/lib/supabase/client";
import { fetchEarliestYear } from "@/lib/utils/fetchEarliestYear";

const AUDIT_ACTIONS: AuditAction[] = [
  "create", "update", "delete", "login", "logout", "role_change",
];

const filterInputCls =
  "rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-(--color-text-strong) focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";

export default function AuditLogsPage() {
  const dispatch = useAppDispatch();
  const logs = useAppSelector((s) => s.auditLogs.items);
  const page = useAppSelector((s) => s.auditLogs.page);
  const pageSize = useAppSelector((s) => s.auditLogs.pageSize);
  const total = useAppSelector((s) => s.auditLogs.total);
  const isFetching = useAppSelector((s) => s.auditLogs.isFetching);

  const [filters, setFilters] = useState<AuditLogFilters>(DEFAULT_AUDIT_LOG_FILTERS);
  const hasActive = !isDefaultAuditLogFilters(filters);

  const [earliestYear, setEarliestYear] = useState(new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = await createTenantClient();
      const year = await fetchEarliestYear(async () => {
        const { data } = await supabase
          .from("audit_logs")
          .select("created_at")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        return data?.created_at ?? null;
      });
      if (!cancelled) setEarliestYear(year);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [viewTarget, setViewTarget] = useState<AuditLog | null>(null);

  // ── Filter helpers ────────────────────────────────────────────────────────

  /** Fire a server-side fetch and reset to page 1 when filters change. */
  const applyFilters = useCallback(
    (nextFilters: AuditLogFilters) => {
      dispatch(fetchAuditLogsPage({ page: 1, pageSize, filters: nextFilters }));
    },
    [dispatch, pageSize]
  );

  function setFilter<K extends keyof AuditLogFilters>(key: K, value: AuditLogFilters[K]) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    applyFilters(next);
  }

  // Atomic — see sales/page.tsx's setPeriod and FilterBar's SKILL.md entry for why three separate setFilter calls would silently drop two of three fields.
  function setPeriod(preset: DatePreset, dateFrom: string, dateTo: string) {
    const next = { ...filters, preset, dateFrom, dateTo };
    setFilters(next);
    applyFilters(next);
  }

  function clearFilters() {
    setFilters(DEFAULT_AUDIT_LOG_FILTERS);
    applyFilters(DEFAULT_AUDIT_LOG_FILTERS);
  }

  const columns = [
    {
      header: "Timestamp",
      render: (log: AuditLog) => (
        <span className="text-xs font-mono text-(--color-text-muted) whitespace-nowrap">
          {formatDateTime(log.created_at)}
        </span>
      ),
    },
    {
      header: "User",
      render: (log: AuditLog) => (
        <span className="text-sm text-(--color-text-base)">{log.user_email ?? "—"}</span>
      ),
    },
    {
      header: "Action",
      render: (log: AuditLog) => <ActionBadge action={log.action} />,
    },
    {
      header: "Entity",
      render: (log: AuditLog) => (
        <span className="text-sm text-(--color-text-base) capitalize">
          {log.entity_type}
          {log.entity_id && (
            <span className="ml-1 text-xs text-(--color-text-faint) font-mono">
              #{log.entity_id.slice(0, 8)}
            </span>
          )}
        </span>
      ),
    },
    {
      header: "View",
      render: (log: AuditLog) => (
        <Button size="icon" variant="ghost" onClick={() => setViewTarget(log)} title="View details">
          <Eye size={15} />
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="Full history of all user actions in the system"
      />

      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        earliestYear={earliestYear}
        onPeriodChange={setPeriod}
        hasActive={hasActive}
        onClear={clearFilters}
      >
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-(--color-text-faint) mb-1">Action</span>
          <select
            value={filters.action}
            onChange={(e) => setFilter("action", e.target.value as AuditAction | "all")}
            className={filterInputCls}
          >
            <option value="all">All Actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        </div>
      </FilterBar>

      {/* Loading overlay — subtle opacity fade while a page fetch is in flight */}
      <div className={isFetching ? "opacity-60 pointer-events-none transition-opacity" : ""}>
        <div className="mb-3 text-sm">
          <span className="text-(--color-text-muted)">
            {total} log entr{total !== 1 ? "ies" : "y"} total
          </span>
        </div>

        <DataTable
          columns={columns}
          rows={logs}
          keyField="id"
          emptyMessage="No audit logs match the current filters."
        />

        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(p) => dispatch(fetchAuditLogsPage({ page: p, pageSize, filters }))}
          onPageSizeChange={(s) => dispatch(fetchAuditLogsPage({ page: 1, pageSize: s, filters }))}
        />
      </div>

      <AuditLogDetailModal log={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
