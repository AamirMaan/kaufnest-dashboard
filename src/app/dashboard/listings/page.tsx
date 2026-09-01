"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/FormFields";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { hasPermission } from "@/lib/utils/permissions";
import { fetchListingsPage, type ListingStatusFilter } from "./_store/listingsSlice";
import { ListingsTable } from "./_components/ListingsTable";
import { BusinessEbayGate } from "./_components/BusinessEbayGate";

// Default view is "Active" (published) — a tenant opening Listings wants to
// see what's currently live on eBay, not the full history of drafts/failed
// attempts/ended listings. "All" and the other statuses are one filter away.
const DEFAULT_STATUS_FILTER: ListingStatusFilter = "published";

const STATUS_FILTER_OPTIONS: { value: ListingStatusFilter; label: string }[] = [
  { value: "published", label: "Active" },
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "publishing", label: "Publishing" },
  { value: "failed", label: "Failed" },
  { value: "inactive", label: "Inactive" },
];

export default function ListingsPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const permissionOverrides = useAppSelector((s) => s.currentUser.profile?.permission_overrides);
  const { items, page, pageSize, total, isFetching } = useAppSelector((s) => s.listings);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ListingStatusFilter>(DEFAULT_STATUS_FILTER);

  const canManage = role && hasPermission(role, "manage_listings", permissionOverrides);

  // The layout's initial hydration reads page 1 unfiltered (same contract
  // every paginated feature's hydration follows), but this page's default
  // view is filtered to "Active" — so the first render always needs one
  // extra fetch to apply that default, unlike Sales/Expenses/Purchases
  // whose default filter is "all" and already matches the hydrated data.
  useEffect(() => {
    dispatch(fetchListingsPage({ page: 1, pageSize, status: DEFAULT_STATUS_FILTER }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goToPage(nextPage: number) {
    dispatch(fetchListingsPage({ page: nextPage, pageSize, status: statusFilter }));
  }

  function handleStatusFilterChange(next: ListingStatusFilter) {
    setStatusFilter(next);
    dispatch(fetchListingsPage({ page: 1, pageSize, status: next }));
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/listings/ebay/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      success(`Synced from eBay: ${json.imported} imported, ${json.deactivated} marked inactive.`);
      dispatch(fetchListingsPage({ page: 1, pageSize, status: statusFilter }));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <BusinessEbayGate>
      <div>
        <PageHeader
          title="Listings"
          description="Publish products to eBay from Inventory or a dropship source"
          action={
            canManage && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={handleSync} disabled={syncing}>
                  <RefreshCw size={14} />
                  {syncing ? "Syncing…" : "Sync from eBay"}
                </Button>
                <Link href="/dashboard/listings/new">
                  <Button size="sm">
                    <Plus size={14} />
                    New Listing
                  </Button>
                </Link>
              </div>
            )
          }
        />

        <div className="mb-4 flex items-center gap-2">
          <label htmlFor="listing-status-filter" className="text-sm text-(--color-text-muted)">
            Status
          </label>
          <div className="w-40">
            <Select
              id="listing-status-filter"
              value={statusFilter}
              onChange={(e) => handleStatusFilterChange(e.target.value as ListingStatusFilter)}
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </div>
        </div>

        {isFetching && (
          <div className="mb-4 text-sm text-(--color-text-muted)">Loading…</div>
        )}

        <ListingsTable listings={items} />

        <div className="mt-3">
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} />
        </div>
      </div>
    </BusinessEbayGate>
  );
}
