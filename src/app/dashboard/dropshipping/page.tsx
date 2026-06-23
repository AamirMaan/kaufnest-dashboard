"use client";

import { useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import { hasPermission } from "@/lib/utils/permissions";
import { upsertListings } from "./_store/dropshippingSlice";
import { ListingsTable } from "./_components/ListingsTable";
import type { DropshipListing } from "@/types";

export default function DropshippingPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const connections = useAppSelector((s) => s.integrations.connections);
  const listings = useAppSelector((s) => s.dropshipping.listings);
  const [refreshing, setRefreshing] = useState(false);

  // 1. Plan gate
  if (!tenantPlan || !hasPlatformIntegrations(tenantPlan)) {
    return (
      <div>
        <PageHeader
          title="Dropshipping Listings"
          description="Manage your active eBay listings and link supplier source products"
        />
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h2 className="text-sm font-semibold text-[var(--color-text-strong)]">
            Upgrade to unlock Dropshipping
          </h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Dropshipping listing management is available on the Pro and Business plans.
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-4 inline-block text-sm font-medium text-[var(--color-primary)] hover:underline"
          >
            View plans &amp; billing →
          </Link>
        </div>
      </div>
    );
  }

  // 2. eBay connection guard
  const ebayConnection = connections.find((c) => c.platform === "ebay");
  if (!ebayConnection || ebayConnection.status !== "connected") {
    return (
      <div>
        <PageHeader
          title="Dropshipping Listings"
          description="Manage your active eBay listings and link supplier source products"
        />
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h2 className="text-sm font-semibold text-[var(--color-text-strong)]">
            eBay connection required
          </h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Connect your eBay seller account in Integrations to import your active listings.
          </p>
          <Link
            href="/dashboard/integrations"
            className="mt-4 inline-block text-sm font-medium text-[var(--color-primary)] hover:underline"
          >
            Go to Integrations →
          </Link>
        </div>
      </div>
    );
  }

  const canRefresh = role && hasPermission(role, "manage_integrations");

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/dropshipping/listings/refresh", { method: "POST" });
      const json = (await res.json()) as { synced?: number; error?: string };

      if (!res.ok) {
        throw new Error(json.error ?? "Refresh failed");
      }

      // Re-fetch all listings to get the updated rows (with created_at, ids, etc.)
      const listingsRes = await fetch("/api/dropshipping/listings");
      if (listingsRes.ok) {
        const updated = (await listingsRes.json()) as DropshipListing[];
        dispatch(upsertListings(updated));
      }

      success(`Synced ${json.synced ?? 0} listing${json.synced === 1 ? "" : "s"} from eBay.`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Dropshipping Listings"
        description="Active eBay listings with linked supplier source products"
        action={
          canRefresh ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Refreshing…" : "Refresh from eBay"}
            </Button>
          ) : undefined
        }
      />

      <ListingsTable listings={listings} />
    </div>
  );
}
