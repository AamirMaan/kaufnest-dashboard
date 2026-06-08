"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Checkbox, Row } from "@/components/ui/FormFields";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSale } from "../_store/salesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { readInvoiceSettings } from "@/lib/hooks/useInvoiceSettings";
import { vatAmountFromGross } from "@/lib/utils/currency";
import { selectableProducts, productNameFor } from "./productOptions";
import type { Platform, Currency, Sale } from "@/types";

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
  reason: string;
}

function saleToForm(sale: Sale): FormState {
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
    vat_rate: sale.vat_rate != null ? String(sale.vat_rate) : String(readInvoiceSettings().vatRate),
    reason: "",
  };
}

const blankForm: FormState = {
  platform: "amazon", product_name: "", product_id: "", quantity: "1", unit_price: "", currency: "EUR",
  date: "", description: "", vat_included: false, vat_rate: "0", reason: "",
};

export function EditSaleModal({ sale, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const products = useAppSelector((s) => s.inventory.items);
  const [form, setForm] = useState<FormState>(() => (sale ? saleToForm(sale) : blankForm));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!form.reason.trim()) return setError("Reason for edit is required.");
    setError(null);
    setSaving(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error: dbError } = await supabase
      .from("sales")
      .update({
        platform: form.platform,
        product_name: form.product_name.trim(),
        product_id: form.product_id || null,
        quantity: qty,
        unit_price: price,
        currency: form.currency,
        date: form.date,
        description: form.description.trim() || null,
        vat_rate: form.vat_included ? vatRate : null,
        vat_amount: form.vat_included ? vatAmount : null,
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

    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "update",
      entityType: "sale",
      entityId: sale.id,
      metadata: {
        before: { platform: sale.platform, product_name: sale.product_name, product_id: sale.product_id, quantity: sale.quantity, unit_price: sale.unit_price, currency: sale.currency, date: sale.date, description: sale.description, vat_rate: sale.vat_rate, vat_amount: sale.vat_amount },
        after:  { platform: data.platform, product_name: data.product_name, product_id: data.product_id, quantity: data.quantity, unit_price: data.unit_price, currency: data.currency, date: data.date, description: data.description, vat_rate: data.vat_rate, vat_amount: data.vat_amount },
        reason: form.reason.trim(),
      },
    });
    if (log) dispatch(addAuditLog(log));

    setSaving(false);
    onSuccess?.();
    onClose();
  }

  return (
    <Modal
      title="Edit Sale"
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

        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional notes…" />
        </Field>

        <Field label="Reason for Edit" required>
          <Textarea
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
            placeholder="Briefly explain why this record is being edited…"
            required
          />
        </Field>
      </form>
    </Modal>
  );
}
