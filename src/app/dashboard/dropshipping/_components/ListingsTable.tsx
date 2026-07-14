"use client";

import { useState, useMemo } from "react";
import { ImageIcon, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { formatCurrency } from "@/lib/utils/currency";
import { isAliExpressSku, aliExpressUrlFromSku } from "@/lib/utils/detectPlatform";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch } from "@/store/hooks";
import { updateSupplierPrices } from "../_store/dropshippingSlice";
import { computeMarginPct, marginBadgeVariant } from "./marginMath";
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

/** AliExpress link or numeric SKU (= AliExpress item ID) — see `isAliExpressSku`. */
export function canCheckSupplierPrice(listing: DropshipListing): boolean {
  if (listing.source_url && listing.source_platform === "aliexpress") return true;
  return isAliExpressSku(listing.sku);
}

interface PriceCheckResult {
  id: string;
  ok: boolean;
  supplier_price?: number;
  supplier_currency?: string;
  supplier_price_checked_at?: string;
  error?: string;
}

function SupplierPriceCell({ listing }: { listing: DropshipListing }) {
  if (listing.supplier_price == null) {
    return <span className="text-[var(--color-text-faint)]">—</span>;
  }

  const marginPct = computeMarginPct(listing);

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[var(--color-text-base)]">
        {formatCurrency(listing.supplier_price, listing.supplier_currency as Currency)}
      </span>
      {listing.customs_tax_rate != null && (
        <span className="text-xs text-[var(--color-text-faint)]">
          Customs: {listing.customs_tax_rate}%
          {listing.customs_tax_amount != null && (
            <> ({formatCurrency(listing.customs_tax_amount, listing.supplier_currency as Currency)})</>
          )}
        </span>
      )}
      {marginPct !== null && (
        <div>
          <Badge
            label={`${Math.round(marginPct)}% margin`}
            variant={marginBadgeVariant(marginPct)}
          />
        </div>
      )}
      {listing.supplier_price_checked_at && (
        <span className="text-xs text-[var(--color-text-faint)]">
          {new Date(listing.supplier_price_checked_at).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

function SourceBadge({ listing }: { listing: DropshipListing }) {
  // Not linked yet, but the SKU is a numeric AliExpress item ID — show the
  // derived URL as a display-time fallback (not persisted until the user saves).
  const derivedUrl = !listing.source_url && isAliExpressSku(listing.sku)
    ? aliExpressUrlFromSku(listing.sku)
    : null;

  if (!listing.source_url && !derivedUrl) {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--color-surface-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
        Unlinked
      </span>
    );
  }

  const url = listing.source_url ?? derivedUrl!;
  const platform = listing.source_url ? listing.source_platform : "aliexpress";

  const label = platform === "amazon" ? "Amazon" : platform === "aliexpress" ? "AliExpress" : "Linked";

  const badgeClass = platform === "amazon"
    ? "bg-blue-50 text-blue-700"
    : platform === "aliexpress"
    ? "bg-orange-50 text-orange-700"
    : "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]";

  return (
    <div className="flex flex-col gap-1">
      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", badgeClass)}>
        {label}
      </span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-[var(--color-primary)] hover:underline truncate max-w-[180px] block"
      >
        {url}
      </a>
      {derivedUrl && (
        <span className="text-xs italic text-[var(--color-text-faint)]">
          detected from SKU — not saved
        </span>
      )}
    </div>
  );
}

export function ListingsTable({ listings }: ListingsTableProps) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const [editTarget, setEditTarget] = useState<DropshipListing | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  async function handleCheckPrice(listing: DropshipListing) {
    setCheckingId(listing.id);
    try {
      const res = await fetch("/api/dropshipping/listings/check-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: listing.id }),
      });
      const json = (await res.json()) as { results?: PriceCheckResult[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Price check failed");

      const result = json.results?.[0];
      if (!result?.ok || result.supplier_price == null) {
        throw new Error(result?.error ?? "Price check failed");
      }

      dispatch(
        updateSupplierPrices([
          {
            id: result.id,
            supplier_price: result.supplier_price,
            supplier_currency: result.supplier_currency ?? "EUR",
            supplier_price_checked_at:
              result.supplier_price_checked_at ?? new Date().toISOString(),
          },
        ])
      );
      success("AliExpress price updated.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Price check failed");
    } finally {
      setCheckingId(null);
    }
  }

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
              <TableHead className="w-28">eBay Price</TableHead>
              <TableHead className="w-36">AliExpress Price</TableHead>
              <TableHead className="w-32">SKU</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
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
                  <SupplierPriceCell listing={listing} />
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
                  <div className="flex items-center justify-end gap-1">
                    {canCheckSupplierPrice(listing) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCheckPrice(listing)}
                        disabled={checkingId !== null}
                        title="Check AliExpress price"
                        aria-label="Check AliExpress price"
                      >
                        <RefreshCw
                          size={14}
                          className={checkingId === listing.id ? "animate-spin" : ""}
                        />
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditTarget(listing)}
                    >
                      Edit
                    </Button>
                  </div>
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
