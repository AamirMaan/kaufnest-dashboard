"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Checkbox, Row } from "@/components/ui/FormFields";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addPurchase } from "../_store/purchasesSlice";
import { addProduct, updateProduct } from "@/app/dashboard/inventory/_store/inventorySlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { vatAmountFromGross } from "@/lib/utils/currency";
import type { Currency, Purchase, Product } from "@/types";

const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: (productName: string) => void;
}

interface FormState {
  product_name: string;
  product_id: string;
  quantity: string;
  unit_price: string;
  currency: Currency;
  vendor: string;
  date: string;
  description: string;
  vat_included: boolean;
  vat_rate: string;
  add_to_inventory: boolean;
  new_sku: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function makeDefaults(defaultVatRate: number): FormState {
  return {
    product_name: "",
    product_id: "",
    quantity: "1",
    unit_price: "",
    currency: "EUR",
    vendor: "",
    date: today(),
    description: "",
    vat_included: false,
    vat_rate: String(defaultVatRate),
    add_to_inventory: false,
    new_sku: "",
  };
}

export function AddPurchaseModal({ open, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const products = useAppSelector((s) => s.inventory.items);
  const defaultVatRate = useAppSelector((s) => s.companyProfile.profile?.vat_rate ?? 19);
  const [form, setForm] = useState<FormState>(() => makeDefaults(defaultVatRate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // When an existing inventory product is selected, auto-fill name and clear the
  // "add to inventory" section (it's already there).
  function selectProduct(id: string) {
    const product = products.find((p) => p.id === id);
    setForm((prev) => ({
      ...prev,
      product_id: id,
      product_name: product ? product.name : prev.product_name,
      add_to_inventory: false,
      new_sku: "",
    }));
  }

  // Show "Add to inventory?" prompt when the typed name is new (no match in inventory).
  const isNewProductName =
    form.product_id === "" &&
    form.product_name.trim().length > 1 &&
    !products.some((p) => p.name.toLowerCase() === form.product_name.trim().toLowerCase());

  const qty = Math.max(1, parseInt(form.quantity) || 1);
  const price = parseFloat(form.unit_price) || 0;
  const total = qty * price;
  const vatRate = parseFloat(form.vat_rate) || 0;
  const vatAmount = form.vat_included ? vatAmountFromGross(total, vatRate) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.product_name.trim()) return setError("Product name is required.");
    if (price <= 0) return setError("Unit price must be greater than 0.");
    setError(null);
    setSaving(true);

    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();

    // If the user wants to register this product in inventory, create it first.
    let resolvedProductId = form.product_id || null;
    if (form.add_to_inventory && isNewProductName) {
      const { data: newProduct, error: productError } = await supabase
        .from("products")
        .insert({ name: form.product_name.trim(), sku: form.new_sku.trim() || null, created_by: user!.id })
        .select()
        .single<Product>();
      if (productError) { setError(productError.message); setSaving(false); return; }
      dispatch(addProduct(newProduct));
      resolvedProductId = newProduct.id;
    }

    const { data, error: dbError } = await supabase
      .from("purchases")
      .insert({
        product_name: form.product_name.trim(),
        product_id: resolvedProductId,
        quantity: qty,
        unit_price: price,
        total_amount: total,
        currency: form.currency,
        vendor: form.vendor.trim() || null,
        date: form.date,
        description: form.description.trim() || null,
        created_by: user!.id,
        vat_rate: form.vat_included ? vatRate : null,
        vat_amount: form.vat_included ? vatAmount : null,
      })
      .select()
      .single<Purchase>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(addPurchase(data));

    // Re-fetch only the affected product to reflect the stock-sync trigger result.
    if (data.product_id) {
      const { data: freshProduct } = await supabase
        .from("products").select("*").eq("id", data.product_id).single<Product>();
      if (freshProduct) dispatch(updateProduct(freshProduct));
    }

    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "create",
      entityType: "purchase",
      entityId: data.id,
      metadata: { product_name: data.product_name, vendor: data.vendor, total_amount: data.total_amount },
    });
    if (log) dispatch(addAuditLog(log));

    setForm(makeDefaults(defaultVatRate));
    setSaving(false);
    onSuccess?.(data.product_name);
    onClose();
  }

  function handleClose() {
    setForm(makeDefaults(defaultVatRate));
    setError(null);
    onClose();
  }

  return (
    <Modal
      title="Add Purchase"
      open={open}
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="add-purchase-form" disabled={saving}>
            {saving ? "Saving…" : "Add Purchase"}
          </Button>
        </>
      }
    >
      <form id="add-purchase-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <Field label="Product Name" required>
          <Input
            value={form.product_name}
            onChange={(e) => set("product_name", e.target.value)}
            placeholder="e.g. USB-C Cables x 100"
            required
          />
        </Field>

        <Field label="Inventory Product">
          <Select value={form.product_id} onChange={(e) => selectProduct(e.target.value)}>
            <option value="">— Not tracked —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.sku ? ` (${p.sku})` : ""}
              </option>
            ))}
          </Select>
        </Field>

        {isNewProductName && (
          <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border)] p-4">
            <Checkbox
              label={`Add "${form.product_name.trim()}" to inventory`}
              checked={form.add_to_inventory}
              onChange={(e) => set("add_to_inventory", e.target.checked)}
            />
            {form.add_to_inventory && (
              <Field label="SKU (optional)">
                <Input
                  value={form.new_sku}
                  onChange={(e) => set("new_sku", e.target.value)}
                  placeholder="e.g. WM-100"
                />
              </Field>
            )}
          </div>
        )}

        <Row>
          <Field label="Vendor">
            <Input
              value={form.vendor}
              onChange={(e) => set("vendor", e.target.value)}
              placeholder="e.g. Alibaba Supplier"
            />
          </Field>

          <Field label="Date" required>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
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
            Total: <span className="font-semibold text-[var(--color-warning)]">
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

        <Field label="Description">
          <Textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Optional notes…"
          />
        </Field>
      </form>
    </Modal>
  );
}
