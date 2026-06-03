"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Row } from "@/components/ui/FormFields";
import { useAppDispatch } from "@/store/hooks";
import { addPurchase } from "@/store/slices/purchasesSlice";
import { createClient } from "@/lib/supabase/client";
import type { Currency, Purchase } from "@/types";

const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FormState {
  product_name: string;
  quantity: string;
  unit_price: string;
  currency: Currency;
  vendor: string;
  date: string;
  description: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const defaults: FormState = {
  product_name: "",
  quantity: "1",
  unit_price: "",
  currency: "EUR",
  vendor: "",
  date: today(),
  description: "",
};

export function AddPurchaseModal({ open, onClose }: Props) {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState<FormState>(defaults);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const qty = Math.max(1, parseInt(form.quantity) || 1);
  const price = parseFloat(form.unit_price) || 0;
  const total = qty * price;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.product_name.trim()) return setError("Product name is required.");
    if (price <= 0) return setError("Unit price must be greater than 0.");
    setError(null);
    setSaving(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error: dbError } = await supabase
      .from("purchases")
      .insert({
        product_name: form.product_name.trim(),
        quantity: qty,
        unit_price: price,
        total_amount: total,
        currency: form.currency,
        vendor: form.vendor.trim() || null,
        date: form.date,
        description: form.description.trim() || null,
        created_by: user!.id,
      })
      .select()
      .single<Purchase>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(addPurchase(data));
    setForm({ ...defaults, date: today() });
    setSaving(false);
    onClose();
  }

  function handleClose() {
    setForm({ ...defaults, date: today() });
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
