"use client";

import { useState, useMemo } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { formatCurrency } from "@/lib/utils/currency";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EditSourceModal } from "./EditSourceModal";
import type { DropshipListing, Currency } from "@/types";

const DEFAULT_PAGE_SIZE = 25;

interface ListingsTableProps {
  listings: DropshipListing[];
}

function SourceBadge({ listing }: { listing: DropshipListing }) {
  if (!listing.source_url) {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--color-surface-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
        Unlinked
      </span>
    );
  }

  const label = listing.source_platform === "amazon"
    ? "Amazon"
    : listing.source_platform === "aliexpress"
    ? "AliExpress"
    : "Linked";

  const badgeClass = listing.source_platform === "amazon"
    ? "bg-blue-50 text-blue-700"
    : listing.source_platform === "aliexpress"
    ? "bg-orange-50 text-orange-700"
    : "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]";

  return (
    <div className="flex flex-col gap-1">
      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", badgeClass)}>
        {label}
      </span>
      <a
        href={listing.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-[var(--color-primary)] hover:underline truncate max-w-[180px] block"
      >
        {listing.source_url}
      </a>
    </div>
  );
}

export function ListingsTable({ listings }: ListingsTableProps) {
  const [editTarget, setEditTarget] = useState<DropshipListing | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const pagedListings = useMemo(() => {
    const start = (page - 1) * pageSize;
    return listings.slice(start, start + pageSize);
  }, [listings, page, pageSize]);

  if (listings.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">
          No listings found. Click <strong>Refresh from eBay</strong> to import your active listings.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Image</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-28">Price</TableHead>
              <TableHead className="w-32">SKU</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedListings.map((listing) => (
              <TableRow key={listing.id}>
                <TableCell>
                  {listing.image_url ? (
                    <img
                      src={listing.image_url}
                      alt=""
                      width={48}
                      height={48}
                      className="h-12 w-12 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded bg-[var(--color-surface-subtle)]">
                      <ImageIcon size={20} className="text-[var(--color-text-faint)]" />
                    </div>
                  )}
                </TableCell>
                <TableCell className="max-w-[240px]">
                  <a
                    href={listing.ebay_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-[var(--color-text-base)] hover:text-[var(--color-primary)] hover:underline line-clamp-2"
                  >
                    {listing.title}
                  </a>
                </TableCell>
                <TableCell className="text-sm text-[var(--color-text-base)]">
                  {formatCurrency(listing.current_price, listing.currency as Currency)}
                </TableCell>
                <TableCell className="text-sm">
                  {listing.sku ? (
                    <span className="text-[var(--color-text-base)]">{listing.sku}</span>
                  ) : (
                    <span className="text-[var(--color-text-faint)]">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <SourceBadge listing={listing} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditTarget(listing)}
                  >
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={listings.length}
        onPageChange={(p) => setPage(p)}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />

      <EditSourceModal key={editTarget?.id ?? "none"} listing={editTarget} onClose={() => setEditTarget(null)} />
    </>
  );
}
