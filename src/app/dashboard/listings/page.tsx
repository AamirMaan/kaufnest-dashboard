"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { hasPermission } from "@/lib/utils/permissions";
import { fetchListingsPage } from "./_store/listingsSlice";
import { ListingsTable } from "./_components/ListingsTable";
import { BusinessEbayGate } from "./_components/BusinessEbayGate";

export default function ListingsPage() {
  const dispatch = useAppDispatch();
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const permissionOverrides = useAppSelector((s) => s.currentUser.profile?.permission_overrides);
  const { items, page, pageSize, total, isFetching } = useAppSelector((s) => s.listings);

  const canManage = role && hasPermission(role, "manage_listings", permissionOverrides);

  function goToPage(nextPage: number) {
    dispatch(fetchListingsPage({ page: nextPage, pageSize }));
  }

  return (
    <BusinessEbayGate>
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
    </BusinessEbayGate>
  );
}
