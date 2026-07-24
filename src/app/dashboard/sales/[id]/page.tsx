"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { addSale, removeSale } from "../_store/salesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { PlatformBadge, StatusBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { EditSaleModal } from "../_components/EditSaleModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, formatDateTime } from "@/lib/utils/date";
import { computeNetProceeds, computeGrossProfit } from "../_components/orderMath";
import { updateProduct } from "@/app/dashboard/inventory/_store/inventorySlice";
import { generateOrderInvoice } from "@/lib/utils/generateInvoice";
import { ArrowLeft, Pencil, Download, Trash2 } from "lucide-react";
import { addPurchase } from "@/app/dashboard/purchases/_store/purchasesSlice";
import type { Sale, Purchase, Product } from "@/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function SaleDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { success, error: toastError, warning } = useToast();

  // Role gating — mirror exactly from sales/page.tsx
  const isSuperAdmin = useAppSelector(
    (s) => s.currentUser.profile?.role === "super_admin"
  );
  const hasDeleteOverride = useAppSelector(
    (s) => s.currentUser.profile?.permission_overrides?.includes("delete_sale") ?? false
  );
  const canDelete = isSuperAdmin || hasDeleteOverride;

  // Try Redux store first (fast path — already hydrated on navigation from list)
  const storeItems = useAppSelector((s) => s.sales.items);

  // Company profile — initialised by the dashboard layout, used for invoice generation
  const companyProfile = useAppSelector((s) => s.companyProfile.profile);

  // Inventory items for product name lookup
  const inventoryItems = useAppSelector((s) => s.inventory.items);

  // storeVersion is always up-to-date (EditSaleModal dispatches updateSale on save)
  const storeVersion = storeItems.find((s) => s.id === id) ?? null;

  // fetchedSale holds the result of a direct-URL Supabase fetch (only used when
  // the item isn't in the Redux store yet). Once addSale is dispatched, storeVersion
  // takes over and fetchedSale becomes irrelevant.
  const [fetchedSale, setFetchedSale] = useState<Sale | null>(null);
  // Start in loading state only when the item is not already in Redux
  const [loading, setLoading] = useState(!storeVersion);
  const [notFound, setNotFound] = useState(false);

  // Prefer the Redux store; fall back to the locally-fetched copy
  const sale = storeVersion ?? fetchedSale;

  const purchases = useAppSelector((s) => s.purchases.items);
  const [fetchedLinkedPurchase, setFetchedLinkedPurchase] =
    useState<Purchase | null>(null);

  // Fast path: linked purchase already in Redux state
  // Fallback: fetched directly from Supabase on direct-URL load
  const linkedPurchase: Purchase | null =
    purchases.find((p) => p.sale_id === sale?.id) ?? fetchedLinkedPurchase;

  // Direct URL hit — fetch from Supabase if not already in Redux.
  // loading is initialised as !storeVersion so when storeVersion is truthy
  // we never enter loading state and this effect exits immediately without
  // touching state (avoids the set-state-in-effect lint rule).
  useEffect(() => {
    if (storeVersion) return;

    let cancelled = false;

    async function fetchSale() {
      setLoading(true);
      try {
        const supabase = await createTenantClient();
        const { data, error: dbError } = await supabase
          .from("sales")
          .select("*")
          .eq("id", id)
          .single<Sale>();

        if (cancelled) return;

        if (dbError || !data) {
          setNotFound(true);
          return;
        }

        setFetchedSale(data);
        // Hydrate into Redux so back-navigation doesn't re-fetch
        dispatch(addSale(data));
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSale();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // ^ intentionally omit storeVersion/dispatch — we only want this to run once
  //   per id; Redux updates flow through storeVersion without re-triggering the fetch

  // Fetch the linked purchase from Supabase on direct-URL load.
  // Skipped when Redux already has it (fast path from list-page navigation).
  useEffect(() => {
    if (!sale?.id) return;
    // Skip if Redux already has the linked purchase
    if (purchases.some((p) => p.sale_id === sale.id)) return;

    let cancelled = false;

    (async () => {
      const supabase = await createTenantClient();
      const { data } = await supabase
        .from("purchases")
        .select("*")
        .eq("sale_id", sale.id)
        .maybeSingle();
      if (!cancelled && data) {
        setFetchedLinkedPurchase(data as Purchase);
        dispatch(addPurchase(data as Purchase)); // hydrate Redux for future navigation
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale?.id]);
  // ^ omit purchases/dispatch — we only want this to fire once per sale id;
  //   Redux updates flow through linkedPurchase without re-triggering the fetch

  // Modal state
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function handleDownloadInvoice() {
    if (!sale || !companyProfile) return;
    await generateOrderInvoice(sale, companyProfile);
  }

  async function handleDelete(reason: string) {
    if (!sale) return;
    const supabase = await createTenantClient();
    const { error: dbError } = await supabase
      .from("sales")
      .delete()
      .eq("id", sale.id);

    if (dbError) {
      toastError("Delete failed", dbError.message);
      return;
    }

    dispatch(removeSale(sale.id));

    // Re-fetch affected product — DB trigger restored its stock
    if (sale.product_id) {
      const { data: fresh } = await supabase
        .from("products")
        .select("*")
        .eq("id", sale.product_id)
        .single<Product>();
      if (fresh) dispatch(updateProduct(fresh));
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "delete",
      entityType: "sale",
      entityId: sale.id,
      metadata: { before: sale, reason },
    });
    if (log) dispatch(addAuditLog(log));

    success("Order deleted", `"${sale.product_name}" has been removed.`);
    router.push("/dashboard/sales");
  }

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-(--color-text-muted) text-sm">
        Loading order…
      </div>
    );
  }

  // ── Not-found state ───────────────────────────────────────────────────────

  if (notFound || !sale) {
    return (
      <div className="py-24 text-center space-y-4">
        <p className="text-lg font-semibold text-(--color-text-strong)">
          Order not found
        </p>
        <p className="text-sm text-(--color-text-muted)">
          The order you&apos;re looking for doesn&apos;t exist or you
          don&apos;t have access to it.
        </p>
        <Link
          href="/dashboard/sales"
          className="inline-flex items-center gap-1.5 text-sm text-(--color-primary) hover:underline"
        >
          <ArrowLeft size={14} />
          Back to Orders
        </Link>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const netProceeds = computeNetProceeds(sale);
  const grossProfit = computeGrossProfit(netProceeds, linkedPurchase);

  // Guard: only show Cost of Goods / Gross Profit when the purchase currency
  // matches the sale currency — mismatched currencies produce a meaningless number.
  const hasCurrencyMatch =
    !linkedPurchase || linkedPurchase.currency === sale.currency;

  const linkedProduct = sale.product_id
    ? (inventoryItems.find((p) => p.id === sale.product_id) ?? null)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={sale.product_name}
        action={
          <Link
            href="/dashboard/sales"
            className="inline-flex items-center gap-1.5 text-sm text-(--color-text-muted) hover:text-(--color-text-base) transition-colors"
          >
            <ArrowLeft size={14} />
            Back to Orders
          </Link>
        }
      />

      {/* Badges + date row — rendered outside PageHeader since description is string-only */}
      <div className="flex flex-wrap items-center gap-2 -mt-4">
        <StatusBadge status={sale.status} />
        {sale.platform && <PlatformBadge platform={sale.platform} />}
        <span className="text-sm text-(--color-text-muted)">{formatDate(sale.date)}</span>
      </div>

      {/* Order identifiers */}
      <div className="flex flex-wrap gap-4 text-xs text-(--color-text-muted)">
        <span>
          <span className="font-medium text-(--color-text-base)">
            Order ID:{" "}
          </span>
          {sale.id}
        </span>
        {sale.external_order_id && (
          <span>
            <span className="font-medium text-(--color-text-base)">
              Platform Order ID:{" "}
            </span>
            {sale.external_order_id}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Financials card */}
        <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6 space-y-4">
          <h2 className="text-base font-semibold text-(--color-text-strong)">
            Financials
          </h2>

          <dl className="space-y-2">
            <FinRow label="Quantity" value={String(sale.quantity)} />
            <FinRow
              label="Unit Price"
              value={formatCurrency(sale.unit_price, sale.currency)}
            />
            <FinRow
              label="Item Total"
              value={
                <span className="font-semibold text-(--color-success)">
                  {formatCurrency(sale.total_amount, sale.currency)}
                </span>
              }
            />

            <div className="border-t border-(--color-border) my-2" />

            <FinRow
              label="VAT Rate"
              value={sale.vat_rate != null ? `${sale.vat_rate}%` : "—"}
            />
            <FinRow
              label="VAT Amount"
              value={
                sale.vat_amount != null
                  ? formatCurrency(sale.vat_amount, sale.currency)
                  : "—"
              }
            />

            <div className="border-t border-(--color-border) my-2" />

            <FinRow
              label="Shipping Charged"
              value={formatCurrency(sale.shipping_charged ?? 0, sale.currency)}
            />
            <FinRow
              label="Shipping Cost"
              value={
                sale.shipping_cost != null
                  ? formatCurrency(sale.shipping_cost, sale.currency)
                  : "—"
              }
            />
            <FinRow
              label="Advertising Fee"
              value={
                sale.advertising_fee != null
                  ? formatCurrency(sale.advertising_fee, sale.currency)
                  : "—"
              }
            />

            <div className="border-t border-(--color-border) my-2" />

            <FinRow
              label="Net Proceeds"
              value={
                <span className="font-bold text-(--color-text-strong)">
                  {formatCurrency(netProceeds, sale.currency)}
                </span>
              }
            />

            {linkedPurchase && hasCurrencyMatch && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-(--color-text-muted)">Cost of Goods</span>
                  <span className="text-(--color-danger-text)">
                    −{formatCurrency(linkedPurchase.total_amount, linkedPurchase.currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm font-semibold border-t border-(--color-border) pt-2 mt-1">
                  <span className="text-(--color-text-base)">Gross Profit</span>
                  <span
                    className={
                      grossProfit !== null && grossProfit < 0
                        ? "text-(--color-danger-text)"
                        : "text-(--color-success-text)"
                    }
                  >
                    {formatCurrency(grossProfit ?? 0, sale.currency)}
                  </span>
                </div>
                <div className="text-right mt-1">
                  <Link
                    href="/dashboard/purchases"
                    className="text-xs text-(--color-primary) hover:underline"
                  >
                    View purchase record →
                  </Link>
                </div>
              </>
            )}
          </dl>
        </section>

        {/* Details card */}
        <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6 space-y-4">
          <h2 className="text-base font-semibold text-(--color-text-strong)">
            Details
          </h2>

          <dl className="space-y-3">
            {sale.description && (
              <div>
                <dt className="text-xs font-medium text-(--color-text-muted) uppercase tracking-wider mb-1">
                  Description
                </dt>
                <dd className="text-sm text-(--color-text-base)">
                  {sale.description}
                </dd>
              </div>
            )}

            <FinRow
              label="Linked Product"
              value={
                linkedProduct ? (
                  <Link
                    href="/dashboard/inventory"
                    className="text-(--color-primary) hover:underline text-sm"
                  >
                    {linkedProduct.name}
                  </Link>
                ) : (
                  "—"
                )
              }
            />

            {sale.restock && (
              <div className="rounded-(--radius-btn) bg-(--color-success-bg) border border-green-200 px-3 py-2 text-xs text-(--color-success-text)">
                Item returned to stock (resellable)
              </div>
            )}

            <FinRow label="Created By" value={sale.created_by} />
            <FinRow
              label="Created At"
              value={formatDateTime(sale.created_at)}
            />
          </dl>
        </section>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button variant="secondary" onClick={() => setEditOpen(true)}>
          <Pencil size={15} />
          Edit Order
        </Button>

        <Button
          variant="secondary"
          onClick={handleDownloadInvoice}
          disabled={!companyProfile}
          title={!companyProfile ? "Company profile not loaded" : undefined}
        >
          <Download size={15} />
          Download Invoice
        </Button>

        {canDelete && (
          <Button
            variant="danger"
            onClick={() => {
              warning(
                "Confirm deletion",
                `You are about to delete "${sale.product_name}".`
              );
              setDeleteOpen(true);
            }}
          >
            <Trash2 size={15} />
            Delete Order
          </Button>
        )}
      </div>

      {/* Modals */}
      <EditSaleModal
        key={sale.id}
        sale={editOpen ? sale : null}
        onClose={() => setEditOpen(false)}
        onSuccess={() => success("Order updated", "Changes have been saved.")}
      />
      <DeleteConfirmModal
        open={deleteOpen}
        title="Delete Order"
        description={`This will permanently delete "${sale.product_name}". This action cannot be undone.`}
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

// ── Local presentational helper ───────────────────────────────────────────────

function FinRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt className="text-(--color-text-muted) shrink-0">{label}</dt>
      <dd className="text-(--color-text-base) text-right">{value}</dd>
    </div>
  );
}
