"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useAccess } from "@/store/useAccess";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { Pagination } from "@/components/ui/Pagination";
import { PlatformBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { RecordTransferModal } from "../_components/RecordTransferModal";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import { pageAfterRemoval } from "@/lib/utils/pagedQuery";
import type { DatePreset } from "@/lib/utils/filters";
import type { PlatformPayout } from "@/types";
import { fetchPayoutsPage } from "./_store/payoutsSlice";
import {
  DEFAULT_PAYOUT_FILTERS,
  isDefaultPayoutFilters,
  type PayoutFilters,
  type PayoutPlatformFilter,
} from "./_lib/payoutFilters";

const filterInputCls =
  "rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-(--color-text-strong) focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";

export default function PayoutsPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const { items, page, pageSize, total, loaded, isFetching, error, filters: appliedFilters } = useAppSelector((s) => s.payouts);
  const users = useAppSelector((s) => s.users.items);
  const baseCurrency = useAppSelector((s) => s.companyProfile.profile?.currency) ?? "EUR";
  const { can } = useAccess();
  const canRecord = can("payouts", 2);
  const canDelete = can("payouts", 3);

  const [filters, setFilters] = useState<PayoutFilters>(appliedFilters);
  const [recordOpen, setRecordOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlatformPayout | null>(null);
  const hasActive = !isDefaultPayoutFilters(filters);

  useEffect(() => {
    if (!loaded) dispatch(fetchPayoutsPage({ page: 1, pageSize, filters: DEFAULT_PAYOUT_FILTERS }));
  }, [loaded, pageSize, dispatch]);

  const userName = useMemo(() => {
    const byId = new Map(users.map((u) => [u.id, u.full_name || u.email]));
    return (id: string) => byId.get(id) ?? "—";
  }, [users]);

  function applyFilters(next: PayoutFilters) {
    setFilters(next);
    dispatch(fetchPayoutsPage({ page: 1, pageSize, filters: next }));
  }

  function setFilter<K extends keyof PayoutFilters>(key: K, value: PayoutFilters[K]) {
    applyFilters({ ...filters, [key]: value });
  }

  // Atomic — three separate setFilter calls would drop two of three fields (see FilterBar's SKILL.md).
  function setPeriod(preset: DatePreset, dateFrom: string, dateTo: string) {
    applyFilters({ ...filters, preset, dateFrom, dateTo });
  }

  function handleSaved() {
    setRecordOpen(false);
    dispatch(fetchPayoutsPage({ page: 1, pageSize, filters }));
  }

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      const supabase = await createTenantClient();
      const { data, error: deleteError } = await supabase
        .from("platform_payouts")
        .delete()
        .eq("id", target.id)
        .select("id");
      if (deleteError) {
        toastError("Delete failed", "Could not delete the transfer. Please try again.");
        return;
      }
      // RLS turns a forbidden delete into a silent 0-row no-op, not an error.
      if (!data || data.length === 0) {
        toastError("Delete failed", "You don't have permission to delete this transfer, or it no longer exists.");
        return;
      }
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const log = await writeAuditLog(supabase, {
            userId: user.id,
            userEmail: user.email ?? "",
            action: "delete",
            entityType: "payout",
            entityId: target.id,
            metadata: { before: target, reason },
          });
          if (log) dispatch(addAuditLog(log));
        }
      } catch {
        // Best-effort: the payout is already deleted.
      }
      success("Transfer deleted", `${formatCurrency(target.amount, target.currency)} on ${formatDate(target.date)} was removed.`);
      setDeleteTarget(null);
      dispatch(fetchPayoutsPage({ page: pageAfterRemoval(page, pageSize, total), pageSize, filters }));
    } catch {
      // Keep deleteTarget so the modal stays open for a retry.
      toastError("Delete failed", "Please check your connection and try again.");
    }
  }

  const columns = [
    {
      header: "Date",
      render: (p: PlatformPayout) => <span className="text-sm text-(--color-text-muted) whitespace-nowrap">{formatDate(p.date)}</span>,
    },
    { header: "Platform", render: (p: PlatformPayout) => <PlatformBadge platform={p.platform} /> },
    {
      header: "Amount",
      render: (p: PlatformPayout) => (
        <span className="text-sm font-semibold tabular-nums text-(--color-text-strong)">{formatCurrency(p.amount, p.currency)}</span>
      ),
    },
    { header: "Notes", render: (p: PlatformPayout) => <span className="text-sm text-(--color-text-muted)">{p.notes ?? "—"}</span> },
    { header: "Recorded by", render: (p: PlatformPayout) => <span className="text-sm text-(--color-text-base)">{userName(p.created_by)}</span> },
    ...(canDelete
      ? [
          {
            header: "Actions",
            render: (p: PlatformPayout) => (
              <Button
                size="icon"
                variant="danger"
                onClick={() => setDeleteTarget(p)}
                title="Delete"
                aria-label={`Delete transfer of ${formatCurrency(p.amount, p.currency)} on ${formatDate(p.date)}`}
              >
                <Trash2 size={15} />
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Payouts"
        description="Transfers recorded from eBay and Amazon to your bank"
        action={canRecord ? <Button onClick={() => setRecordOpen(true)}>+ Record Transfer</Button> : undefined}
      />

      <FilterBar
        preset={filters.preset}
        onPresetChange={(v) => setFilter("preset", v as DatePreset)}
        dateFrom={filters.dateFrom}
        onDateFromChange={(v) => setFilter("dateFrom", v)}
        dateTo={filters.dateTo}
        onDateToChange={(v) => setFilter("dateTo", v)}
        onPeriodChange={setPeriod}
        currency={filters.currency}
        onCurrencyChange={(v) => setFilter("currency", v)}
        hasActive={hasActive}
        onClear={() => applyFilters(DEFAULT_PAYOUT_FILTERS)}
      >
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-(--color-text-faint) mb-1">Platform</span>
          <select
            value={filters.platform}
            onChange={(e) => setFilter("platform", e.target.value as PayoutPlatformFilter)}
            className={filterInputCls}
            aria-label="Platform"
          >
            <option value="all">All Platforms</option>
            <option value="ebay">eBay</option>
            <option value="amazon">Amazon</option>
          </select>
        </div>
      </FilterBar>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4">
          <p className="text-sm text-(--color-text-muted)">{error}</p>
          <Button variant="secondary" onClick={() => dispatch(fetchPayoutsPage({ page, pageSize, filters }))}>
            <RefreshCw size={15} aria-hidden /> Retry
          </Button>
        </div>
      )}

      <div className={isFetching ? "opacity-60 pointer-events-none transition-opacity" : ""}>
        <DataTable
          columns={columns}
          rows={items}
          keyField="id"
          emptyMessage={
            !loaded
              ? error ? "Transfers couldn't be loaded." : "Loading transfers…"
              : hasActive ? "No transfers match the current filters." : "No transfers recorded yet."
          }
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(p) => dispatch(fetchPayoutsPage({ page: p, pageSize, filters }))}
          onPageSizeChange={(s) => dispatch(fetchPayoutsPage({ page: 1, pageSize: s, filters }))}
        />
      </div>

      {canRecord && recordOpen && (
        <RecordTransferModal currency={baseCurrency} onClose={() => setRecordOpen(false)} onSaved={handleSaved} />
      )}
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Transfer"
        description={
          deleteTarget
            ? `This will permanently delete the ${formatCurrency(deleteTarget.amount, deleteTarget.currency)} transfer from ${deleteTarget.platform === "ebay" ? "eBay" : "Amazon"} on ${formatDate(deleteTarget.date)}. Platform balances will be recalculated.`
            : ""
        }
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
