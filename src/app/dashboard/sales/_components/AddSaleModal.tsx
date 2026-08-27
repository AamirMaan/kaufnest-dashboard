"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Checkbox, Row } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addSale } from "../_store/salesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { addPurchase } from "@/app/dashboard/purchases/_store/purchasesSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { vatAmountFromGross } from "@/lib/utils/currency";
import { selectableProducts, productNameFor } from "./productOptions";
import { ORDER_STATUSES, statusLabel } from "./orderStatus";
import { FeeAmountOrPercentField } from "./FeeAmountOrPercentField";
import { updateProduct } from "@/app/dashboard/inventory/_store/inventorySlice";
import type { Platform, Currency, Sale, Purchase, Product } from "@/types";

const PLATFORMS: Platform[] = ["amazon", "ebay", "etsy", "shopify", "other"];
const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: (productName: string) => void;
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
  shipping_cost: string;
  shipping_charged: string;
  advertising_fee: string;
  platform_fee: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function makeDefaults(defaultVatRate: number): FormState {
  return {
    platform: "amazon",
    product_name: "",
    product_id: "",
    quantity: "1",
    unit_price: "",
    currency: "EUR",
    date: today(),
    description: "",
    vat_included: false,
    vat_rate: String(defaultVatRate),
    status: "pending",
    customStatus: "",
    restock: false,
    shipping_cost: "",
    shipping_charged: "",
    advertising_fee: "",
    platform_fee: "",
  };
}

export function AddSaleModal({ open, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const products = useAppSelector((s) => s.inventory.selectorItems);
  const defaultVatRate = useAppSelector((s) => s.companyProfile.profile?.vat_rate ?? 19);
  const { error: toastError } = useToast();
  const [form, setForm] = useState<FormState>(() => makeDefaults(defaultVatRate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFees, setShowFees] = useState(false);
  const [showLinkedPurchase, setShowLinkedPurchase] = useState(false);
  const [purchasePrice, setPurchasePrice] = useState("");
  const [purchaseVendor, setPurchaseVendor] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const availableProducts = selectableProducts(products);

  function selectProduct(id: string) {
    const name = productNameFor(products, id);
    setForm((prev) => ({
      ...prev,
      product_id: id,
      product_name: name ?? prev.product_name,
    }));
  }

  const qty = Math.max(1, parseInt(form.quantity) || 1);
  const price = parseFloat(form.unit_price) || 0;
  const total = qty * price;
  const vatRate = parseFloat(form.vat_rate) || 0;
  const vatAmount = form.vat_included ? vatAmountFromGross(total, vatRate) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.product_name.trim()) return setError("Product name is required.");
    if (price <= 0) return setError("Unit price must be greater than 0.");
    if (form.status === "other" && !form.customStatus.trim()) return setError("Custom status is required.");
    setError(null);
    setSaving(true);

    const status = form.status === "other" ? form.customStatus.trim() : form.status;
    const restock = status === "returned" ? form.restock : false;

    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();

    const shippingCost = form.shipping_cost !== "" ? parseFloat(form.shipping_cost) : null;
    const shippingCharged = form.shipping_charged !== "" ? parseFloat(form.shipping_charged) : null;
    const advertisingFee = form.advertising_fee !== "" ? parseFloat(form.advertising_fee) : null;
    const platformFee = form.platform_fee !== "" ? parseFloat(form.platform_fee) : null;

    const { data, error: dbError } = await supabase
      .from("sales")
      .insert({
        platform: form.platform,
        product_name: form.product_name.trim(),
        product_id: form.product_id || null,
        quantity: qty,
        unit_price: price,
        total_amount: total,
        currency: form.currency,
        date: form.date,
        description: form.description.trim() || null,
        created_by: user!.id,
        vat_rate: form.vat_included ? vatRate : null,
        vat_amount: form.vat_included ? vatAmount : null,
        shipping_cost: shippingCost,
        shipping_charged: shippingCharged,
        advertising_fee: advertisingFee,
        platform_fee: platformFee,
        status,
        restock,
      })
      .select()
      .single<Sale>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(addSale(data));

    // Create linked purchase if price was provided
    const rawPrice = parseFloat(purchasePrice);
    if (showLinkedPurchase && !isNaN(rawPrice) && rawPrice > 0) {
      const purchaseQty = parseInt(form.quantity, 10) || 1;
      const { data: newPurchase, error: purchaseError } = await supabase
        .from("purchases")
        .insert({
          product_name: form.product_name,
          product_id: form.product_id || null,
          quantity: purchaseQty,
          unit_price: rawPrice / purchaseQty,
          total_amount: rawPrice,
          currency: form.currency,
          vendor: purchaseVendor.trim() || null,
          date: purchaseDate,
          description: null,
          vat_rate: null,
          vat_amount: null,
          sale_id: data.id,
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
          metadata: { linked_to_sale: data.id },
        });
        if (purchaseLog) dispatch(addAuditLog(purchaseLog));
      } else if (purchaseError) {
        toastError("Linked purchase not saved", "Your order was saved but the linked purchase could not be created — add it manually from the Purchases page.");
      }
    }

    // Re-fetch only the linked product to reflect the stock-sync trigger result.
    if (data.product_id) {
      const { data: freshProduct } = await supabase
        .from("products").select("*").eq("id", data.product_id).single<Product>();
      if (freshProduct) dispatch(updateProduct(freshProduct));
    }

    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "create",
      entityType: "sale",
      entityId: data.id,
      metadata: { product_name: data.product_name, platform: data.platform, total_amount: data.total_amount },
    });
    if (log) dispatch(addAuditLog(log));

    setForm(makeDefaults(defaultVatRate));
    setShowFees(false);
    setShowLinkedPurchase(false);
    setPurchasePrice("");
    setPurchaseVendor("");
    setPurchaseDate(new Date().toISOString().split("T")[0]);
    setSaving(false);
    onSuccess?.(data.product_name);
    onClose();
  }

  function handleClose() {
    setForm(makeDefaults(defaultVatRate));
    setError(null);
    setShowFees(false);
    setShowLinkedPurchase(false);
    setPurchasePrice("");
    setPurchaseVendor("");
    setPurchaseDate(new Date().toISOString().split("T")[0]);
    onClose();
  }

  return (
    <Modal
      title="Add Order"
      open={open}
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="add-sale-form" disabled={saving}>
            {saving ? "Saving…" : "Add Order"}
          </Button>
        </>
      }
    >
      <form id="add-sale-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <Field label="Product Name" required>
          <Input
            value={form.product_name}
            onChange={(e) => set("product_name", e.target.value)}
            placeholder="e.g. Wireless Headphones"
            required
          />
        </Field>

        <Field label="Inventory Product">
          <Select
            value={form.product_id}
            onChange={(e) => selectProduct(e.target.value)}
          >
            <option value="">— Not tracked —</option>
            {availableProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.sku ? ` (${p.sku})` : ""} — {p.current_stock} in stock
              </option>
            ))}
          </Select>
          {availableProducts.length === 0 && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              No products currently have stock — record a purchase first to make one sellable here.
            </p>
          )}
        </Field>

        <Row>
          <Field label="Platform" required>
            <Select
              value={form.platform}
              onChange={(e) => set("platform", e.target.value as Platform)}
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Date" required>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => {
                setForm((f) => ({ ...f, date: e.target.value }));
                setPurchaseDate(e.target.value); // keep purchase date in sync with sale date
              }}
              required
            />
          </Field>
        </Row>

        <Row>
          <Field label="Quantity" required>
            <Input
              type="number"
              min="1"
              step="1"
              value={form.quantity}
              onChange={(e) => set("quantity", e.target.value)}
              required
            />
          </Field>

          <Field label="Currency" required>
            <Select
              value={form.currency}
              onChange={(e) => set("currency", e.target.value as Currency)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </Row>

        <Field label="Unit Price" required>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={form.unit_price}
            onChange={(e) => set("unit_price", e.target.value)}
            placeholder="0.00"
            required
          />
        </Field>

        {price > 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Total: <span className="font-semibold text-[var(--color-success)]">
              {form.currency} {total.toFixed(2)}
            </span>
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
        </div>

        <Field label="Description">
          <Textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Optional notes…"
          />
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

        {/* ── Purchase cost (optional) ── */}
        <div className="rounded-(--radius-card) border border-(--color-border)">
          <button
            type="button"
            onClick={() => setShowLinkedPurchase((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-(--color-text-strong) hover:bg-(--color-surface-raised) transition-colors rounded-(--radius-card)"
          >
            <span>Purchase cost (optional)</span>
            <ChevronDown
              size={16}
              className={`transition-transform text-(--color-text-muted) ${showLinkedPurchase ? "rotate-180" : ""}`}
            />
          </button>

          {showLinkedPurchase && (
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
        </div>
      </form>
    </Modal>
  );
}
