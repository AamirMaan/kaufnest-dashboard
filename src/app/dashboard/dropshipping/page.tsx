"use client";

import { useState } from "react";
import Link from "next/link";
import { RefreshCw, TriangleAlert, X } from "lucide-react";
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
  const [skuError, setSkuError] = useState(false);

  // 1. Plan gate
  if (!tenantPlan || !hasPlatformIntegrations(tenantPlan)) {
    return (
      <div>
        <PageHeader
          title="Dropshipping Listings"
          description="Manage your active eBay listings and link supplier source products"
        />
        <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6">
          <h2 className="text-sm font-semibold text-(--color-text-strong)">
            Upgrade to unlock Dropshipping
          </h2>
          <p className="mt-2 text-sm text-(--color-text-muted)">
            Dropshipping listing management is available on the Pro and Business plans.
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

  // 2. eBay connection guard
  const ebayConnection = connections.find((c) => c.platform === "ebay");
  if (!ebayConnection || ebayConnection.status !== "connected") {
    return (
      <div>
        <PageHeader
          title="Dropshipping Listings"
          description="Manage your active eBay listings and link supplier source products"
        />
        <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6">
          <h2 className="text-sm font-semibold text-(--color-text-strong)">
            eBay connection required
          </h2>
          <p className="mt-2 text-sm text-(--color-text-muted)">
            Connect your eBay seller account in Integrations to import your active listings.
          </p>
          <Link
            href="/dashboard/integrations"
            className="mt-4 inline-block text-sm font-medium text-(--color-primary) hover:underline"
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

      setSkuError(false);
      success(`Synced ${json.synced ?? 0} listing${json.synced === 1 ? "" : "s"} from eBay.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Refresh failed";
      if (message.includes("Custom Label")) {
        setSkuError(true);
      } else {
        toastError(message);
      }
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

      {skuError && (
        <div
          className="mb-4 rounded-(--radius-card) border p-4"
          style={{
            borderColor: "var(--color-warning, #f59e0b)",
            background: "color-mix(in srgb, var(--color-warning, #f59e0b) 10%, var(--color-surface))",
          }}
        >
          <div className="flex items-start gap-3">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning, #f59e0b)" }} />
            <div className="flex-1 text-sm">
              <p className="font-semibold text-(--color-text-strong)">
                eBay listings are missing Custom Labels (SKUs)
              </p>
              <p className="mt-1 text-(--color-text-muted)">
                The eBay Inventory API requires every listing to have a Custom Label. Listings
                without one cannot be synced. To fix this:
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-(--color-text-muted)">
                <li>Go to <strong className="text-(--color-text-strong)">eBay Seller Hub → Listings → Active</strong></li>
                <li>Open each listing and fill in the <strong className="text-(--color-text-strong)">Custom Label (SKU)</strong> field</li>
                <li>Use letters and numbers only — no hyphens, spaces, or special characters</li>
                <li>Return here and click <strong className="text-(--color-text-strong)">Refresh from eBay</strong></li>
              </ol>
              <a
                href="https://www.ebay.com/sh/lst/active"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block font-medium text-(--color-primary) underline underline-offset-2"
              >
                Open eBay Seller Hub →
              </a>
            </div>
            <button
              onClick={() => setSkuError(false)}
              className="shrink-0 text-(--color-text-muted) hover:text-(--color-text-strong)"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <ListingsTable listings={listings} />
    </div>
  );
}
