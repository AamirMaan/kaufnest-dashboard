"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Row } from "@/components/ui/FormFields";
import { useAppDispatch } from "@/store/hooks";
import { addSale } from "../_store/salesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import type { Platform, Currency, Sale } from "@/types";

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
  quantity: string;
  unit_price: string;
  currency: Currency;
  date: string;
  description: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const defaults: FormState = {
  platform: "amazon",
  product_name: "",
  quantity: "1",
  unit_price: "",
  currency: "EUR",
  date: today(),
  description: "",
};

export function AddSaleModal({ open, onClose, onSuccess }: Props) {
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
      .from("sales")
      .insert({
        platform: form.platform,
        product_name: form.product_name.trim(),
        quantity: qty,
        unit_price: price,
        currency: form.currency,
        date: form.date,
        description: form.description.trim() || null,
        created_by: user!.id,
      })
      .select()
      .single<Sale>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(addSale(data));

    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "create",
      entityType: "sale",
      entityId: data.id,
      metadata: { product_name: data.product_name, platform: data.platform, total_amount: data.total_amount },
    });
    if (log) dispatch(addAuditLog(log));

    setForm({ ...defaults, date: today() });
    setSaving(false);
    onSuccess?.(data.product_name);
    onClose();
  }

  function handleClose() {
    setForm({ ...defaults, date: today() });
    setError(null);
    onClose();
  }

  return (
    <Modal
      title="Add Sale"
      open={open}
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="add-sale-form" disabled={saving}>
            {saving ? "Saving…" : "Add Sale"}
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
            Total: <span className="font-semibold text-[var(--color-success)]">
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
