"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Checkbox, Row } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSale, fetchSaleById } from "../_store/salesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { addPurchase } from "@/app/dashboard/purchases/_store/purchasesSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency, vatAmountFromGross } from "@/lib/utils/currency";
import { isEbayIntegrationSyncedSale } from "@/lib/utils/filters";
import { selectableProducts, productNameFor } from "./productOptions";
import { ORDER_STATUSES, isPresetStatus, statusLabel } from "./orderStatus";
import { FeeAmountOrPercentField } from "./FeeAmountOrPercentField";
// Plain data constant (carrier codes), no OAuth/server secrets; needed for
// verifier:allow server-module-in-client — the Carrier <Select> below.
import { EBAY_CARRIER_CODES } from "@/lib/integrations/ebay/carriers";
import { updateProduct } from "@/app/dashboard/inventory/_store/inventorySlice";
import type { Platform, Currency, Sale, Product, Purchase } from "@/types";

const PLATFORMS: Platform[] = ["amazon", "ebay", "etsy", "shopify", "other"];
const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

interface Props {
  sale: Sale | null; // non-null = modal open
  onClose: () => void;
  onSuccess?: () => void;
}

interface FormState {
  platform: Platform;
  product_name: string;
  product_id: string;
  quantity: string;
  unit_price: string;
  currency: Currency;
  date: string;
  description: string;
  vat_included: boolean;
  vat_rate: string;
  status: string; // one of ORDER_STATUSES, or "other"
  customStatus: string;
  restock: boolean;
  reason: string;
  shipping_cost: string;
  shipping_charged: string;
  advertising_fee: string;
  platform_fee: string;
  trackingNumber: string;
  carrier: string;
}

function saleToForm(sale: Sale, defaultVatRate: number): FormState {
  const preset = isPresetStatus(sale.status);
  return {
    platform: sale.platform,
    product_name: sale.product_name,
    product_id: sale.product_id ?? "",
    quantity: String(sale.quantity),
    unit_price: String(sale.unit_price),
    currency: sale.currency,
    date: sale.date,
    description: sale.description ?? "",
    vat_included: sale.vat_rate != null,
    vat_rate: sale.vat_rate != null ? String(sale.vat_rate) : String(defaultVatRate),
    status: preset ? sale.status : "other",
    customStatus: preset ? "" : sale.status,
    restock: sale.restock,
    reason: "",
    shipping_cost: sale.shipping_cost != null ? String(sale.shipping_cost) : "",
    shipping_charged: sale.shipping_charged != null ? String(sale.shipping_charged) : "",
    advertising_fee: sale.advertising_fee != null ? String(sale.advertising_fee) : "",
    platform_fee: sale.platform_fee != null ? String(sale.platform_fee) : "",
    trackingNumber: sale.tracking_number ?? "",
    carrier: sale.shipping_carrier ?? "",
  };
}

const blankForm: FormState = {
  platform: "amazon", product_name: "", product_id: "", quantity: "1", unit_price: "", currency: "EUR",
  date: "", description: "", vat_included: false, vat_rate: "0",
  status: "pending", customStatus: "", restock: false, reason: "",
  shipping_cost: "", shipping_charged: "", advertising_fee: "", platform_fee: "",
  trackingNumber: "", carrier: "",
};

export function EditSaleModal({ sale, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const { error: toastError, warning } = useToast();
  const products = useAppSelector((s) => s.inventory.selectorItems);
  const defaultVatRate = useAppSelector((s) => s.companyProfile.profile?.vat_rate ?? 19);
  const purchases = useAppSelector((s) => s.purchases.items);
  const linkedPurchase = purchases.find((p) => p.sale_id === sale?.id) ?? null;
  const [form, setForm] = useState<FormState>(() => (sale ? saleToForm(sale, defaultVatRate) : blankForm));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFees, setShowFees] = useState(() => {
    if (!sale) return false;
    return (
      sale.shipping_cost != null ||
      sale.shipping_charged != null ||
      sale.advertising_fee != null ||
      sale.platform_fee != null
    );
  });
  const [showAddPurchase, setShowAddPurchase] = useState(false);
  const [purchasePrice, setPurchasePrice] = useState("");
  const [purchaseVendor, setPurchaseVendor] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(
    sale?.date ?? new Date().toISOString().split("T")[0]
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const availableProducts = selectableProducts(products, form.product_id);

  function selectProduct(id: string) {
    const name = productNameFor(products, id);
    setForm((prev) => ({
      ...prev,
      product_id: id,
      product_name: name ?? prev.product_name,
    }));
  }

  // Only orders that came in through the Integrations sync/import pipeline can
  // be pushed back to eBay — see `isEbayIntegrationSyncedSale`'s doc comment
  // for why a CSV-imported "ebay" row is deliberately excluded.
  const isEbayOrder = !!sale && isEbayIntegrationSyncedSale(sale);

  const qty = Math.max(1, parseInt(form.quantity) || 1);
  const price = parseFloat(form.unit_price) || 0;
  const total = qty * price;
  const vatRate = parseFloat(form.vat_rate) || 0;
  const vatAmount = form.vat_included ? vatAmountFromGross(total, vatRate) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sale) return;
    if (!form.product_name.trim()) return setError("Product name is required.");
    if (price <= 0) return setError("Unit price must be greater than 0.");
    if (form.status === "other" && !form.customStatus.trim()) return setError("Custom status is required.");
    if (!form.reason.trim()) return setError("Reason for edit is required.");
    setError(null);
    setSaving(true);

    const status = form.status === "other" ? form.customStatus.trim() : form.status;
    const restock = status === "returned" ? form.restock : false;

    // Tracking/carrier are only *written* when this save sets an eBay order to
    // "shipped" (the one case the form collects them). For every other status
    // the sale's existing values are passed through unchanged — nulling them on
    // the normal shipped → delivered step would erase the record of what was
    // pushed to eBay while `ebay_fulfillment_id` survived, and would leave a
    // pending Retry resending nulls.
    const isEbayShipment = isEbayOrder && status === "shipped";
    const trackingNumber = isEbayShipment
      ? form.trackingNumber.trim() || null
      : sale.tracking_number;
    const shippingCarrier = isEbayShipment ? form.carrier || null : sale.shipping_carrier;

    const shippingCost = form.shipping_cost !== "" ? parseFloat(form.shipping_cost) : null;
    const shippingCharged = form.shipping_charged !== "" ? parseFloat(form.shipping_charged) : null;
    const advertisingFee = form.advertising_fee !== "" ? parseFloat(form.advertising_fee) : null;
    const platformFee = form.platform_fee !== "" ? parseFloat(form.platform_fee) : null;

    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error: dbError } = await supabase
      .from("sales")
      .update({
        platform: form.platform,
        product_name: form.product_name.trim(),
        product_id: form.product_id || null,
        quantity: qty,
        unit_price: price,
        total_amount: total,
        currency: form.currency,
        date: form.date,
        description: form.description.trim() || null,
        vat_rate: form.vat_included ? vatRate : null,
        vat_amount: form.vat_included ? vatAmount : null,
        shipping_cost: shippingCost,
        shipping_charged: shippingCharged,
        advertising_fee: advertisingFee,
        platform_fee: platformFee,
        status,
        restock,
        tracking_number: trackingNumber,
        shipping_carrier: shippingCarrier,
      })
      .eq("id", sale.id)
      .select()
      .single<Sale>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(updateSale(data));

    // Re-fetch product(s) whose stock the trigger may have changed.
    const productIdsToRefresh = new Set(
      [sale.product_id, data.product_id].filter((id): id is string => !!id)
    );
    for (const pid of productIdsToRefresh) {
      const { data: fresh } = await supabase.from("products").select("*").eq("id", pid).single<Product>();
      if (fresh) dispatch(updateProduct(fresh));
    }

    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "update",
      entityType: "sale",
      entityId: sale.id,
      metadata: {
        before: { platform: sale.platform, product_name: sale.product_name, product_id: sale.product_id, quantity: sale.quantity, unit_price: sale.unit_price, currency: sale.currency, date: sale.date, description: sale.description, vat_rate: sale.vat_rate, vat_amount: sale.vat_amount, shipping_cost: sale.shipping_cost, shipping_charged: sale.shipping_charged, advertising_fee: sale.advertising_fee, platform_fee: sale.platform_fee, status: sale.status, restock: sale.restock, tracking_number: sale.tracking_number, shipping_carrier: sale.shipping_carrier },
        after:  { platform: data.platform, product_name: data.product_name, product_id: data.product_id, quantity: data.quantity, unit_price: data.unit_price, currency: data.currency, date: data.date, description: data.description, vat_rate: data.vat_rate, vat_amount: data.vat_amount, shipping_cost: data.shipping_cost, shipping_charged: data.shipping_charged, advertising_fee: data.advertising_fee, platform_fee: data.platform_fee, status: data.status, restock: data.restock, tracking_number: data.tracking_number, shipping_carrier: data.shipping_carrier },
        reason: form.reason.trim(),
      },
    });
    if (log) dispatch(addAuditLog(log));

    // Push the status change to eBay — best-effort, never blocks the save.
    // The local sales row is already committed above; a sync failure here
    // must never look like the edit itself failed.
    if (isEbayOrder && sale.status !== status && (status === "shipped" || status === "cancelled")) {
      let syncError: string | null = null;
      try {
        const syncRes = await fetch(`/api/integrations/ebay/orders/${sale.id}/sync-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, trackingNumber, carrier: shippingCarrier }),
        });
        if (!syncRes.ok) {
          const body = await syncRes.json().catch(() => ({}));
          syncError =
            typeof body.error === "string" && body.error
              ? body.error
              : `eBay sync failed (HTTP ${syncRes.status})`;
          warning("Saved locally, eBay sync failed", body.error ?? "You can retry from the order detail page.");
        }
      } catch {
        syncError = "Could not reach the eBay sync service.";
        warning("Saved locally, eBay sync failed", "You can retry from the order detail page.");
      }

      // Persist the failure on the row ourselves. The route writes
      // `ebay_sync_error` for failures it reaches, but it is gated by
      // `requireIntegrationAdmin()` (`manage_integrations` — admin/super_admin
      // only) while this modal is reachable by anyone with `update_sale`
      // (accountant included). An accountant's save is rejected with a 403
      // *before* the route touches the row, so without this write the order
      // would silently never reach eBay and no admin would ever see a Retry
      // row. Writing it here is safe: the same user just successfully updated
      // this exact row a few lines above.
      if (syncError) {
        await supabase.from("sales").update({ ebay_sync_error: syncError }).eq("id", sale.id);
      }

      // Reconcile Redux with the post-sync row. `data` above is the *pre*-sync
      // state; the ebay_* columns were written afterwards (by the route, or by
      // the client-side write above). The order detail page renders from Redux
      // whenever a store version exists and never re-fetches, so skipping this
      // means the Retry row never appears — and a stale error from an earlier
      // attempt never clears — until a hard reload.
      const fresh = await fetchSaleById(sale.id);
      if (fresh) dispatch(updateSale(fresh));
    }

    // Create linked purchase if user filled one in and no purchase is linked yet
    const rawPrice = parseFloat(purchasePrice);
    if (!linkedPurchase && showAddPurchase && !isNaN(rawPrice) && rawPrice > 0) {
      const qtyNum = parseInt(form.quantity, 10) || 1;
      const { data: newPurchase, error: purchaseError } = await supabase
        .from("purchases")
        .insert({
          product_name: form.product_name.trim(),
          product_id: form.product_id || null,
          quantity: qtyNum,
          unit_price: rawPrice / qtyNum,
          total_amount: rawPrice,
          currency: form.currency,
          vendor: purchaseVendor.trim() || null,
          date: purchaseDate,
          description: null,
          vat_rate: null,
          vat_amount: null,
          sale_id: sale.id,
          created_by: user!.id,
        })
        .select()
        .single();

      if (!purchaseError && newPurchase) {
        dispatch(addPurchase(newPurchase as Purchase));
        const purchaseLog = await writeAuditLog(supabase, {
          userId: user!.id,
          userEmail: user!.email ?? "",
          action: "create",
          entityType: "purchase",
          entityId: newPurchase.id,
          metadata: { linked_to_sale: sale.id },
        });
        if (purchaseLog) dispatch(addAuditLog(purchaseLog));
      } else if (purchaseError) {
        toastError("Linked purchase not saved", "Your order was saved but the linked purchase could not be created — add it manually from the Purchases page.");
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSuccess?.();
    onClose();
  }

  return (
    <Modal
      title="Edit Order"
      open={!!sale}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="edit-sale-form" disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </>
      }
    >
      <form id="edit-sale-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <Field label="Product Name" required>
          <Input value={form.product_name} onChange={(e) => set("product_name", e.target.value)} required />
        </Field>

        <Field label="Inventory Product">
          <Select value={form.product_id} onChange={(e) => selectProduct(e.target.value)}>
            <option value="">— Not tracked —</option>
            {availableProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.sku ? ` (${p.sku})` : ""} — {p.current_stock} in stock
              </option>
            ))}
          </Select>
        </Field>

        <Row>
          <Field label="Platform" required>
            <Select value={form.platform} onChange={(e) => set("platform", e.target.value as Platform)}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date" required>
            <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required />
          </Field>
        </Row>

        <Row>
          <Field label="Quantity" required>
            <Input type="number" min="1" step="1" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} required />
          </Field>
          <Field label="Currency" required>
            <Select value={form.currency} onChange={(e) => set("currency", e.target.value as Currency)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </Row>

        <Field label="Unit Price" required>
          <Input type="number" min="0.01" step="0.01" value={form.unit_price} onChange={(e) => set("unit_price", e.target.value)} required />
        </Field>

        {price > 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Total: <span className="font-semibold text-[var(--color-success)]">{form.currency} {total.toFixed(2)}</span>
          </p>
        )}

        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border)] p-4">
          <Checkbox
            label="Total includes VAT"
            checked={form.vat_included}
            onChange={(e) => set("vat_included", e.target.checked)}
          />
          {form.vat_included && (
            <>
              <Field label="VAT Rate (%)">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={form.vat_rate}
                  onChange={(e) => set("vat_rate", e.target.value)}
                />
              </Field>
              {total > 0 && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Net {form.currency} {(total - vatAmount).toFixed(2)} · VAT {form.currency} {vatAmount.toFixed(2)} · Gross {form.currency} {total.toFixed(2)}
                </p>
              )}
            </>
          )}
        </div>

        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border)] p-4">
          <Field label="Status" required>
            <Select
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
              <option value="other">Other…</option>
            </Select>
          </Field>
          {form.status === "other" && (
            <Field label="Custom Status" required>
              <Input
                value={form.customStatus}
                onChange={(e) => set("customStatus", e.target.value)}
                placeholder="e.g. Awaiting customs"
                required
              />
            </Field>
          )}
          {form.status === "returned" && (
            <Checkbox
              label="Item can be resold (restock inventory)"
              checked={form.restock}
              onChange={(e) => set("restock", e.target.checked)}
            />
          )}
          {isEbayOrder && form.status === "shipped" && (
            <Row>
              <Field label="Carrier" required>
                <Select
                  value={form.carrier}
                  onChange={(e) => set("carrier", e.target.value)}
                  required
                >
                  <option value="">— Select carrier —</option>
                  {EBAY_CARRIER_CODES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Tracking Number" required>
                <Input
                  value={form.trackingNumber}
                  onChange={(e) => set("trackingNumber", e.target.value)}
                  placeholder="e.g. 1Z999AA10123456784"
                  required
                />
              </Field>
            </Row>
          )}
        </div>

        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional notes…" />
        </Field>

        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => setShowFees((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--color-text-strong)] hover:bg-[var(--color-surface-raised)] transition-colors rounded-[var(--radius-card)]"
          >
            <span>Fees &amp; shipping (optional)</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform text-[var(--color-text-muted)] ${showFees ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showFees && (
            <div className="px-4 pb-4 space-y-3 border-t border-[var(--color-border)] pt-3">
              <Row>
                <Field label="Shipping Cost (paid by you)">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.shipping_cost}
                    onChange={(e) => set("shipping_cost", e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
                <Field label="Shipping Charged (billed to buyer)">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.shipping_charged}
                    onChange={(e) => set("shipping_charged", e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
              </Row>
              <Row>
                <FeeAmountOrPercentField
                  label="Advertising Fee"
                  value={form.advertising_fee}
                  onChange={(v) => set("advertising_fee", v)}
                  itemTotal={total}
                  currency={form.currency}
                />
                <FeeAmountOrPercentField
                  label="Platform Fee"
                  value={form.platform_fee}
                  onChange={(v) => set("platform_fee", v)}
                  itemTotal={total}
                  currency={form.currency}
                />
              </Row>
            </div>
          )}
        </div>

        <Field label="Reason for Edit" required>
          <Textarea
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
            placeholder="Briefly explain why this record is being edited…"
            required
          />
        </Field>

        {/* ── Linked Purchase ── */}
        <div className="rounded-(--radius-card) border border-(--color-border)">
          {linkedPurchase ? (
            /* Read-only chip */
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-faint) mb-0.5">
                  Linked Purchase
                </p>
                <p className="text-sm text-(--color-text-base)">
                  {formatCurrency(linkedPurchase.total_amount, linkedPurchase.currency)}
                  {linkedPurchase.vendor ? ` · ${linkedPurchase.vendor}` : ""}
                </p>
              </div>
              <Link
                href="/dashboard/purchases"
                className="text-xs text-(--color-primary) hover:underline shrink-0 ml-3"
              >
                View →
              </Link>
            </div>
          ) : (
            /* No linked purchase — offer to add */
            <>
              <button
                type="button"
                onClick={() => setShowAddPurchase((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-(--color-text-strong) hover:bg-(--color-surface-raised) transition-colors rounded-(--radius-card)"
              >
                <span>Add purchase cost (optional)</span>
                <ChevronDown
                  size={16}
                  className={`transition-transform text-(--color-text-muted) ${showAddPurchase ? "rotate-180" : ""}`}
                />
              </button>

              {showAddPurchase && (
                <div className="px-4 pb-4 space-y-3 border-t border-(--color-border) pt-3">
                  <div>
                    <label className="block text-xs font-medium text-(--color-text-muted) mb-1">
                      Purchase Price (total paid)
                      <span className="text-(--color-danger-text) ml-0.5">*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={purchasePrice}
                      onChange={(e) => setPurchasePrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm text-(--color-text-base) placeholder:text-(--color-text-faint) focus:outline-none focus:ring-2 focus:ring-(--color-primary)"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-(--color-text-muted) mb-1">
                      Vendor
                    </label>
                    <input
                      type="text"
                      value={purchaseVendor}
                      onChange={(e) => setPurchaseVendor(e.target.value)}
                      placeholder="e.g. Alibaba, wholesaler name"
                      className="w-full rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm text-(--color-text-base) placeholder:text-(--color-text-faint) focus:outline-none focus:ring-2 focus:ring-(--color-primary)"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-(--color-text-muted) mb-1">
                      Purchase Date
                    </label>
                    <input
                      type="date"
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                      className="w-full rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm text-(--color-text-base) focus:outline-none focus:ring-2 focus:ring-(--color-primary)"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
