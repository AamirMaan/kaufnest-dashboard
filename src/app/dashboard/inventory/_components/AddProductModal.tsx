"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Row } from "@/components/ui/FormFields";
import { useAppDispatch } from "@/store/hooks";
import { addProduct } from "../_store/inventorySlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import type { Product } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: (name: string) => void;
}

interface FormState {
  name: string;
  sku: string;
  reorder_threshold: string;
}

const defaults: FormState = {
  name: "",
  sku: "",
  reorder_threshold: "",
};

export function AddProductModal({ open, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState<FormState>(defaults);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Product name is required.");
    setError(null);
    setSaving(true);

    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error: dbError } = await supabase
      .from("products")
      .insert({
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        reorder_threshold: form.reorder_threshold.trim()
          ? parseInt(form.reorder_threshold)
          : null,
        created_by: user!.id,
      })
      .select()
      .single<Product>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(addProduct(data));

    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "create",
      entityType: "product",
      entityId: data.id,
      metadata: { name: data.name, sku: data.sku },
    });
    if (log) dispatch(addAuditLog(log));

    setForm(defaults);
    setSaving(false);
    onSuccess?.(data.name);
    onClose();
  }

  function handleClose() {
    setForm(defaults);
    setError(null);
    onClose();
  }

  return (
    <Modal
      title="Add Product"
      open={open}
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="add-product-form" disabled={saving}>
            {saving ? "Saving…" : "Add Product"}
          </Button>
        </>
      }
    >
      <form id="add-product-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <Field label="Product Name" required>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. USB-C Cable 1m"
            required
          />
        </Field>

        <Row>
          <Field label="SKU">
            <Input
              value={form.sku}
              onChange={(e) => set("sku", e.target.value)}
              placeholder="e.g. USB-C-1M"
            />
          </Field>

          <Field label="Reorder Threshold">
            <Input
              type="number"
              min="0"
              step="1"
              value={form.reorder_threshold}
              onChange={(e) => set("reorder_threshold", e.target.value)}
              placeholder="e.g. 20"
            />
          </Field>
        </Row>

        <p className="text-xs text-[var(--color-text-muted)]">
          Current stock starts at 0 and is kept in sync automatically as you
          link purchases (stock in) and sales (stock out) to this product.
        </p>
      </form>
    </Modal>
  );
}
