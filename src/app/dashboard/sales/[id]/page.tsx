"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { addSale, removeSale, updateSale, fetchSaleById } from "../_store/salesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { PlatformBadge, StatusBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { EditSaleModal } from "../_components/EditSaleModal";
import { GenerateLabelModal } from "../_components/GenerateLabelModal";
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
import type { Sale, Purchase, Product, Shipment, Currency } from "@/types";

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
  // "Generate Shipping Label" role gate — same bar as requireIntegrationAdmin()
  // on the two API routes this button calls (admin/super_admin, OR a user
  // granted the manage_integrations override — see hasPermission() in
  // lib/utils/permissions.ts) and the shipments_insert RLS policy (043_shipments.sql /
  // 005_tenant_provisioning.sql). Must be selected here (before the
  // loading/not-found early returns below), not inside the Derived Values
  // section — calling a new useAppSelector after a conditional return would
  // change the number of hooks called between renders.
  const currentRole = useAppSelector((s) => s.currentUser.profile?.role);
  const isAdmin = currentRole === "admin" || currentRole === "super_admin";
  const hasManageIntegrationsOverride = useAppSelector(
    (s) => s.currentUser.profile?.permission_overrides?.includes("manage_integrations") ?? false
  );
  const canGenerateLabel = isAdmin || hasManageIntegrationsOverride;

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

  // Shipment (shipping-label feature) — same fetch-on-load pattern as the
  // linked purchase above. No Redux slice: a sale has at most one shipment
  // in v1, so it's fetched on-demand rather than hydrated globally.
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [shipmentLoading, setShipmentLoading] = useState(true);
  const [generateLabelOpen, setGenerateLabelOpen] = useState(false);

  useEffect(() => {
    if (!sale?.id) return;
    let cancelled = false;

    (async () => {
      setShipmentLoading(true);
      const supabase = await createTenantClient();
      // .maybeSingle() would throw (PGRST116) if more than one shipment ever
      // exists for this sale — sale_id has no unique constraint (deliberate,
      // see 043_shipments.sql's header comment). Ordering + limit(1) instead
      // tolerates any number of rows without crashing the page; the actual
      // duplicate-purchase guard lives in /api/shipping/buy (Fix 2).
      const { data } = await supabase
        .from("shipments")
        .select("*")
        .eq("sale_id", sale.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancelled) {
        setShipment((data?.[0] as Shipment | undefined) ?? null);
        setShipmentLoading(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale?.id]);
  // ^ same reasoning as the linked-purchase effect above — fire once per
  //   sale id, not on every render.

  // Modal state
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

  async function handleDownloadInvoice() {
    if (!sale || !companyProfile) return;
    await generateOrderInvoice(sale, companyProfile);
  }

  async function handleRetrySync() {
    // Only the two statuses this feature actually pushes to eBay are
    // retryable — resending anything else would be a no-op at best.
    if (!sale || (sale.status !== "shipped" && sale.status !== "cancelled")) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/integrations/ebay/orders/${sale.id}/sync-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: sale.status,
          trackingNumber: sale.tracking_number,
          carrier: sale.shipping_carrier,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toastError("eBay sync failed", body.error ?? "Please try again.");
        return;
      }

      const fresh = await fetchSaleById(sale.id);
      if (fresh) dispatch(updateSale(fresh));
      success("eBay sync succeeded", "The order status was pushed to eBay.");
    } catch {
      toastError("eBay sync failed", "Please try again.");
    } finally {
      setRetrying(false);
    }
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

  // Retry only makes sense for the two statuses this feature pushes to eBay.
  // The error row itself still renders for any other status (otherwise the
  // failure would vanish with no way to see it) — just without the button.
  const canRetrySync = sale.status === "shipped" || sale.status === "cancelled";

  const linkedProduct = sale.product_id
    ? (inventoryItems.find((p) => p.id === sale.product_id) ?? null)
    : null;

  const hasShippingAddress =
    !!sale.buyer_name ||
    !!sale.shipping_address_line1 ||
    !!sale.shipping_address_line2 ||
    !!sale.shipping_city ||
    !!sale.shipping_state ||
    !!sale.shipping_postal_code ||
    !!sale.shipping_country ||
    !!sale.buyer_phone ||
    !!sale.buyer_email;

  // Shipping card gating — mirrors the throw-on-missing checks in
  // src/lib/shipping/addressMappers.ts, checked here client-side so the
  // "Generate Shipping Label" button never appears when it's guaranteed to
  // fail server-side.
  const hasSenderAddress = !!(
    companyProfile?.ship_from_street1 &&
    companyProfile?.ship_from_city &&
    companyProfile?.ship_from_postal_code &&
    companyProfile?.ship_from_country
  );
  const hasBuyerAddress = !!(
    sale.shipping_address_line1 &&
    sale.shipping_city &&
    sale.shipping_postal_code &&
    sale.shipping_country
  );
  const addressesComplete = hasSenderAddress && hasBuyerAddress;

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
            <FinRow
              label="Platform Fee"
              value={
                sale.platform_fee != null
                  ? formatCurrency(sale.platform_fee, sale.currency)
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

            {sale.ebay_sync_error && (
              <div className="rounded-(--radius-btn) bg-(--color-danger-bg) border border-red-200 px-3 py-2 text-xs text-(--color-danger-text) space-y-2">
                <p>eBay sync failed: {sale.ebay_sync_error}</p>
                {canRetrySync ? (
                  <Button variant="secondary" onClick={handleRetrySync} disabled={retrying}>
                    {retrying ? "Retrying…" : "Retry"}
                  </Button>
                ) : (
                  <p>
                    Set this order back to Shipped or Cancelled to retry the sync.
                  </p>
                )}
              </div>
            )}

            {hasShippingAddress && (
              <div>
                <dt className="text-xs font-medium text-(--color-text-muted) uppercase tracking-wider mb-1">
                  Shipping Address
                </dt>
                <dd className="text-sm text-(--color-text-base) space-y-0.5">
                  {sale.buyer_name && (
                    <p className="font-semibold">{sale.buyer_name}</p>
                  )}
                  {sale.shipping_address_line1 && <p>{sale.shipping_address_line1}</p>}
                  {sale.shipping_address_line2 && <p>{sale.shipping_address_line2}</p>}
                  {(sale.shipping_city || sale.shipping_state || sale.shipping_postal_code) && (
                    <p>
                      {[
                        sale.shipping_city,
                        [sale.shipping_state, sale.shipping_postal_code].filter(Boolean).join(" "),
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  )}
                  {sale.shipping_country && <p>{sale.shipping_country}</p>}
                  {sale.buyer_phone && (
                    <p className="text-xs text-(--color-text-muted) pt-1">{sale.buyer_phone}</p>
                  )}
                  {sale.buyer_email && (
                    <p className="text-xs text-(--color-text-muted)">{sale.buyer_email}</p>
                  )}
                </dd>
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

      {/* Shipping card — own card per design, rendered for every sale */}
      <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6 space-y-4">
        <h2 className="text-base font-semibold text-(--color-text-strong)">
          Shipping
        </h2>

        {shipmentLoading ? (
          <p className="text-sm text-(--color-text-muted)">Loading…</p>
        ) : shipment ? (
          <dl className="space-y-2">
            <FinRow label="Carrier" value={`${shipment.carrier} — ${shipment.service}`} />
            <FinRow label="Tracking Number" value={shipment.tracking_number} />
            {shipment.cost != null && (
              <FinRow
                label="Label Cost"
                value={formatCurrency(
                  shipment.cost,
                  (shipment.cost_currency ?? sale.currency) as Currency
                )}
              />
            )}
            <div className="pt-2">
              <a
                href={shipment.label_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-(--color-primary) hover:underline"
              >
                <Download size={14} />
                Download Label
              </a>
            </div>
          </dl>
        ) : !addressesComplete ? (
          <p className="text-sm text-(--color-text-muted)">
            Add a sender address in{" "}
            <Link href="/dashboard/settings" className="text-(--color-primary) hover:underline">
              Settings
            </Link>{" "}
            and a buyer address on this order to generate a shipping label.
          </p>
        ) : canGenerateLabel ? (
          <Button variant="secondary" onClick={() => setGenerateLabelOpen(true)}>
            Generate Shipping Label
          </Button>
        ) : (
          <p className="text-sm text-(--color-text-muted)">
            No label generated for this order yet.
          </p>
        )}
      </section>

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
      <GenerateLabelModal
        sale={generateLabelOpen ? sale : null}
        onClose={() => setGenerateLabelOpen(false)}
        onSuccess={(newShipment) => {
          setShipment(newShipment);
          setGenerateLabelOpen(false);
          success("Shipping label generated", `Tracking number ${newShipment.tracking_number}`);
        }}
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
