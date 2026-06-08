"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Row } from "@/components/ui/FormFields";
import { useAppDispatch } from "@/store/hooks";
import { updatePurchase } from "../_store/purchasesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import type { Currency, Purchase } from "@/types";

const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

interface Props {
  purchase: Purchase | null;
  onClose: () => void;
  onSuccess?: () => void;
}

interface FormState {
  product_name: string;
  quantity: string;
  unit_price: string;
  currency: Currency;
  vendor: string;
  date: string;
  description: string;
  reason: string;
}

function purchaseToForm(p: Purchase): FormState {
  return {
    product_name: p.product_name,
    quantity: String(p.quantity),
    unit_price: String(p.unit_price),
    currency: p.currency,
    vendor: p.vendor ?? "",
    date: p.date,
    description: p.description ?? "",
    reason: "",
  };
}

export function EditPurchaseModal({ purchase, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState<FormState>(() =>
    purchase ? purchaseToForm(purchase) : { product_name: "", quantity: "1", unit_price: "", currency: "EUR", vendor: "", date: "", description: "", reason: "" }
  );
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
    if (!purchase) return;
    if (!form.product_name.trim()) return setError("Product name is required.");
    if (price <= 0) return setError("Unit price must be greater than 0.");
    if (!form.reason.trim()) return setError("Reason for edit is required.");
    setError(null);
    setSaving(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error: dbError } = await supabase
      .from("purchases")
      .update({
        product_name: form.product_name.trim(),
        quantity: qty,
        unit_price: price,
        currency: form.currency,
        vendor: form.vendor.trim() || null,
        date: form.date,
        description: form.description.trim() || null,
      })
      .eq("id", purchase.id)
      .select()
      .single<Purchase>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(updatePurchase(data));

    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "update",
      entityType: "purchase",
      entityId: purchase.id,
      metadata: {
        before: { product_name: purchase.product_name, quantity: purchase.quantity, unit_price: purchase.unit_price, vendor: purchase.vendor, currency: purchase.currency, date: purchase.date },
        after:  { product_name: data.product_name, quantity: data.quantity, unit_price: data.unit_price, vendor: data.vendor, currency: data.currency, date: data.date },
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
      title="Edit Purchase"
      open={!!purchase}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="edit-purchase-form" disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </>
      }
    >
      <form id="edit-purchase-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <Field label="Product Name" required>
          <Input value={form.product_name} onChange={(e) => set("product_name", e.target.value)} required />
        </Field>

        <Row>
          <Field label="Vendor">
            <Input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Optional" />
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
            Total: <span className="font-semibold text-[var(--color-warning)]">{form.currency} {total.toFixed(2)}</span>
          </p>
        )}

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
