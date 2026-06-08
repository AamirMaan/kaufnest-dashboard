"use client";

import { useState } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeProduct } from "./_store/inventorySlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { Pencil, Trash2 } from "lucide-react";
import { AddProductModal } from "./_components/AddProductModal";
import { EditProductModal } from "./_components/EditProductModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import type { Product } from "@/types";

function isLowStock(p: Product): boolean {
  return p.reorder_threshold != null && p.current_stock <= p.reorder_threshold;
}

export default function InventoryPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError, warning } = useToast();
  const products = useAppSelector((s) => s.inventory.items);
  const isSuperAdmin = useAppSelector((s) => s.currentUser.profile?.role === "super_admin");

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const supabase = createClient();
    const { error: dbError } = await supabase.from("products").delete().eq("id", deleteTarget.id);
    if (dbError) { toastError("Delete failed", dbError.message); return; }
    dispatch(removeProduct(deleteTarget.id));
    const { data: { user } } = await supabase.auth.getUser();
    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "delete",
      entityType: "product",
      entityId: deleteTarget.id,
      metadata: { before: deleteTarget, reason },
    });
    if (log) dispatch(addAuditLog(log));
    success("Product deleted", `"${deleteTarget.name}" has been removed.`);
    setDeleteTarget(null);
  }

  const columns = [
    {
      header: "Product",
      sortValue: (p: Product) => p.name.toLowerCase(),
      render: (p: Product) => (
        <span className="text-sm font-medium text-[var(--color-text-strong)]">{p.name}</span>
      ),
    },
    {
      header: "SKU",
      sortValue: (p: Product) => p.sku?.toLowerCase() ?? "",
      render: (p: Product) => (
        <span className="text-sm text-[var(--color-text-muted)]">{p.sku ?? "—"}</span>
      ),
    },
    {
      header: "Current Stock",
      sortValue: (p: Product) => p.current_stock,
      render: (p: Product) => (
        <span className="text-sm font-semibold text-[var(--color-text-base)] tabular-nums">{p.current_stock}</span>
      ),
    },
    {
      header: "Reorder Threshold",
      sortValue: (p: Product) => p.reorder_threshold ?? -1,
      render: (p: Product) => (
        <span className="text-sm text-[var(--color-text-muted)] tabular-nums">{p.reorder_threshold ?? "—"}</span>
      ),
    },
    {
      header: "Status",
      render: (p: Product) =>
        isLowStock(p) ? (
          <Badge label="Low stock" variant="danger" />
        ) : (
          <Badge label="In stock" variant="success" />
        ),
    },
    {
      header: "Actions",
      render: (p: Product) => (
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setEditTarget(p)} title="Edit">
            <Pencil size={15} />
          </Button>
          {isSuperAdmin && (
            <Button
              size="icon"
              variant="danger"
              onClick={() => { warning("Confirm deletion", `You are about to delete "${p.name}".`); setDeleteTarget(p); }}
              title="Delete"
            >
              <Trash2 size={15} />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Products tracked through linked purchases and sales"
        action={<Button onClick={() => setAddOpen(true)}>+ Add Product</Button>}
      />

      <div className="flex items-center justify-between mb-3 text-sm text-[var(--color-text-muted)]">
        <span>{products.length} product{products.length !== 1 ? "s" : ""}</span>
      </div>

      <DataTable
        columns={columns}
        rows={products}
        keyField="id"
        emptyMessage="No products yet — add one, then link it from a purchase or sale to start tracking stock."
      />
      <AddProductModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={(name) => success("Product added", `"${name}" was added to inventory.`)}
      />
      <EditProductModal
        key={editTarget?.id ?? "edit-product"}
        product={editTarget}
        onClose={() => setEditTarget(null)}
        onSuccess={() => success("Product updated", "Changes have been saved.")}
      />
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Product"
        description={`This will permanently delete "${deleteTarget?.name}". Linked purchases/sales keep their history but lose the inventory link. This action cannot be undone.`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
