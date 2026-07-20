"use client";

import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/utils/currency";
import type { EbayListingDraft, ListingStatus } from "@/types";

const STATUS_VARIANTS: Record<ListingStatus, "default" | "success" | "warning" | "danger" | "info"> = {
  draft: "default",
  publishing: "info",
  published: "success",
  failed: "danger",
};

interface Props {
  listings: EbayListingDraft[];
}

export function ListingsTable({ listings }: Props) {
  return (
    <DataTable<EbayListingDraft>
      keyField="id"
      rows={listings}
      emptyMessage="No listings yet. Click “New Listing” to create one."
      columns={[
        {
          header: "Image",
          render: (row) =>
            row.image_urls[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.image_urls[0]} alt="" className="h-10 w-10 rounded object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded bg-(--color-surface-subtle)">
                <ImageIcon size={16} className="text-(--color-text-faint)" />
              </div>
            ),
        },
        {
          header: "Title",
          render: (row) => (
            <Link href={`/dashboard/listings/${row.id}`} className="font-medium text-(--color-primary) hover:underline">
              {row.title}
            </Link>
          ),
        },
        {
          header: "Source",
          render: (row) =>
            row.source_type === "inventory" ? (
              <Badge label="Inventory" variant="info" />
            ) : (
              <Badge label={row.source_platform ?? "Dropship"} variant="default" />
            ),
        },
        {
          header: "Price",
          render: (row) => formatCurrency(row.price, row.currency),
          sortValue: (row) => row.price,
        },
        {
          header: "Status",
          render: (row) => <Badge label={row.status} variant={STATUS_VARIANTS[row.status]} />,
        },
        {
          header: "Actions",
          render: (row) =>
            row.status === "published" && row.ebay_listing_id ? (
              <a
                href={`https://www.ebay.com/itm/${row.ebay_listing_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-(--color-primary) hover:underline"
              >
                View on eBay →
              </a>
            ) : (
              <Link href={`/dashboard/listings/${row.id}`} className="text-sm text-(--color-primary) hover:underline">
                {row.status === "failed" ? "Retry" : "Edit"} →
              </Link>
            ),
        },
      ]}
    />
  );
}
