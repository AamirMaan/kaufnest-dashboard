"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea, Row } from "@/components/ui/FormFields";
import { useAppDispatch } from "@/store/hooks";
import { updateProduct } from "../_store/inventorySlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import type { Product } from "@/types";

interface Props {
  product: Product | null;
  onClose: () => void;
  onSuccess?: () => void;
}

interface FormState {
  name: string;
  sku: string;
  reorder_threshold: string;
  reason: string;
}

function productToForm(p: Product): FormState {
  return {
    name: p.name,
    sku: p.sku ?? "",
    reorder_threshold: p.reorder_threshold != null ? String(p.reorder_threshold) : "",
    reason: "",
  };
}

const blankForm: FormState = { name: "", sku: "", reorder_threshold: "", reason: "" };

export function EditProductModal({ product, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState<FormState>(() => (product ? productToForm(product) : blankForm));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    if (!form.name.trim()) return setError("Product name is required.");
    if (!form.reason.trim()) return setError("Reason for edit is required.");
    setError(null);
    setSaving(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const reorderThreshold = form.reorder_threshold.trim()
      ? parseInt(form.reorder_threshold)
      : null;

    const { data, error: dbError } = await supabase
      .from("products")
      .update({
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        reorder_threshold: reorderThreshold,
      })
      .eq("id", product.id)
      .select()
      .single<Product>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(updateProduct(data));

    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "update",
      entityType: "product",
      entityId: product.id,
      metadata: {
        before: { name: product.name, sku: product.sku, reorder_threshold: product.reorder_threshold },
        after:  { name: data.name, sku: data.sku, reorder_threshold: data.reorder_threshold },
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
      title="Edit Product"
      open={!!product}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="edit-product-form" disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </>
      }
    >
      <form id="edit-product-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <Field label="Product Name" required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>

        <Row>
          <Field label="SKU">
            <Input value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Reorder Threshold">
            <Input
              type="number"
              min="0"
              step="1"
              value={form.reorder_threshold}
              onChange={(e) => set("reorder_threshold", e.target.value)}
              placeholder="Optional"
            />
          </Field>
        </Row>

        <p className="text-xs text-[var(--color-text-muted)]">
          Current stock ({product?.current_stock ?? 0}) isn&apos;t edited here —
          it tracks linked purchases and sales automatically.
        </p>

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
