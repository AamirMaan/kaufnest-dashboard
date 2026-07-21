"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import { hasPermission } from "@/lib/utils/permissions";
import { fetchListingsPage } from "./_store/listingsSlice";
import { ListingsTable } from "./_components/ListingsTable";

export default function ListingsPage() {
  const dispatch = useAppDispatch();
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const { items, page, pageSize, total, isFetching } = useAppSelector((s) => s.listings);

  const canManage = role && hasPermission(role, "manage_listings");

  function goToPage(nextPage: number) {
    dispatch(fetchListingsPage({ page: nextPage, pageSize }));
  }

  if (!tenantPlan || !hasPlatformIntegrations(tenantPlan)) {
    return (
      <div>
        <PageHeader title="Listings" description="Publish products to eBay from your dashboard" />
        <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6">
          <h2 className="text-sm font-semibold text-(--color-text-strong)">
            Upgrade to unlock Listings
          </h2>
          <p className="mt-2 text-sm text-(--color-text-muted)">
            eBay listing creation is available on the Pro and Business plans.
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-4 inline-block text-sm font-medium text-(--color-primary) hover:underline"
          >
            View plans &amp; billing →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Listings"
        description="Publish products to eBay from Inventory or a dropship source"
        action={
          canManage && (
            <Link href="/dashboard/listings/new">
              <Button size="sm">
                <Plus size={14} />
                New Listing
              </Button>
            </Link>
          )
        }
      />

      {isFetching && (
        <div className="mb-4 text-sm text-(--color-text-muted)">Loading…</div>
      )}

      <ListingsTable listings={items} />

      <div className="mt-3">
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} />
      </div>
    </div>
  );
}
