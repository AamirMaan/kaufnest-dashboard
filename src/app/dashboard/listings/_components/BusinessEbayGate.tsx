"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAppSelector } from "@/store/hooks";
import { hasMessagingAndListings } from "@/lib/utils/planGating";

interface Props {
  children: ReactNode;
}

/**
 * Gates every Listings route (list, new, edit) behind the Business plan and
 * a connected eBay account — not just the list page's "New Listing" button.
 * Without this, a Pro tenant (or one with no eBay connection) could bypass
 * the list page's gate entirely by navigating straight to
 * /dashboard/listings/new or /dashboard/listings/[id], since those routes
 * render the listing form directly and had no gate of their own.
 */
export function BusinessEbayGate({ children }: Props) {
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
  const connections = useAppSelector((s) => s.integrations.connections);
  const isEbayConnected = connections.find((c) => c.platform === "ebay")?.status === "connected";

  if (!tenantPlan || !hasMessagingAndListings(tenantPlan)) {
    return (
      <div>
        <PageHeader title="Listings" description="Publish products to eBay from your dashboard" />
        <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6">
          <h2 className="text-sm font-semibold text-(--color-text-strong)">
            Upgrade to unlock Listings
          </h2>
          <p className="mt-2 text-sm text-(--color-text-muted)">
            eBay listing creation is available on the Business plan.
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

  if (!isEbayConnected) {
    return (
      <div>
        <PageHeader title="Listings" description="Publish products to eBay from your dashboard" />
        <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6">
          <h2 className="text-sm font-semibold text-(--color-text-strong)">
            eBay connection required
          </h2>
          <p className="mt-2 text-sm text-(--color-text-muted)">
            Connect your eBay seller account in Integrations to create and publish listings.
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

  return <>{children}</>;
}
