"use client";

import { useState } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removePurchase } from "@/store/slices/purchasesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { AddPurchaseModal } from "@/components/modals/AddPurchaseModal";
import { EditPurchaseModal } from "@/components/modals/EditPurchaseModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import type { Purchase } from "@/types";

export default function PurchasesPage() {
  const dispatch = useAppDispatch();
  const purchases = useAppSelector((s) => s.purchases.items);
  const isSuperAdmin = useAppSelector((s) => s.currentUser.profile?.role === "super_admin");

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Purchase | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const supabase = createClient();
    await supabase.from("purchases").delete().eq("id", deleteTarget.id);
    dispatch(removePurchase(deleteTarget.id));
    const { data: { user } } = await supabase.auth.getUser();
    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "delete",
      entityType: "purchase",
      entityId: deleteTarget.id,
      metadata: { before: deleteTarget, reason },
    });
    if (log) dispatch(addAuditLog(log));
    setDeleteTarget(null);
  }

  const columns = [
    {
      header: "Date",
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">{formatDate(p.date)}</span>
      ),
    },
    {
      header: "Product",
      render: (p: Purchase) => (
        <span className="text-sm font-medium text-[var(--color-text-strong)]">{p.product_name}</span>
      ),
    },
    {
      header: "Vendor",
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-muted)]">{p.vendor ?? "—"}</span>
      ),
    },
    {
      header: "Qty",
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">{p.quantity}</span>
      ),
    },
    {
      header: "Unit Price",
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">{formatCurrency(p.unit_price, p.currency)}</span>
      ),
    },
    {
      header: "Total",
      render: (p: Purchase) => (
        <span className="text-sm font-semibold text-[var(--color-warning)] tabular-nums">{formatCurrency(p.total_amount, p.currency)}</span>
      ),
    },
    {
      header: "Actions",
      render: (p: Purchase) => (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditTarget(p)}>Edit</Button>
          {isSuperAdmin && (
            <Button size="sm" variant="danger" onClick={() => setDeleteTarget(p)}>Delete</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Inventory and stock purchases"
        action={<Button onClick={() => setAddOpen(true)}>+ Add Purchase</Button>}
      />
      <DataTable columns={columns} rows={purchases} keyField="id" emptyMessage="No purchases yet. Add your first purchase." />
      <AddPurchaseModal open={addOpen} onClose={() => setAddOpen(false)} />
      <EditPurchaseModal purchase={editTarget} onClose={() => setEditTarget(null)} />
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Purchase"
        description={`This will permanently delete "${deleteTarget?.product_name}". This action cannot be undone.`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
