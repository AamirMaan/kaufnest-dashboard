"use client";

import { useState } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeSale } from "@/store/slices/salesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PlatformBadge } from "@/components/ui/Badge";
import { AddSaleModal } from "@/components/modals/AddSaleModal";
import { EditSaleModal } from "@/components/modals/EditSaleModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import type { Sale } from "@/types";

export default function SalesPage() {
  const dispatch = useAppDispatch();
  const sales = useAppSelector((s) => s.sales.items);
  const isSuperAdmin = useAppSelector((s) => s.currentUser.profile?.role === "super_admin");

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Sale | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sale | null>(null);

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    const supabase = createClient();
    await supabase.from("sales").delete().eq("id", deleteTarget.id);
    dispatch(removeSale(deleteTarget.id));
    const { data: { user } } = await supabase.auth.getUser();
    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "delete",
      entityType: "sale",
      entityId: deleteTarget.id,
      metadata: { before: deleteTarget, reason },
    });
    if (log) dispatch(addAuditLog(log));
    setDeleteTarget(null);
  }

  const columns = [
    {
      header: "Date",
      render: (s: Sale) => (
        <span className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">{formatDate(s.date)}</span>
      ),
    },
    {
      header: "Product",
      render: (s: Sale) => (
        <span className="text-sm font-medium text-[var(--color-text-strong)]">{s.product_name}</span>
      ),
    },
    {
      header: "Platform",
      render: (s: Sale) => <PlatformBadge platform={s.platform} />,
    },
    {
      header: "Qty",
      render: (s: Sale) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">{s.quantity}</span>
      ),
    },
    {
      header: "Unit Price",
      render: (s: Sale) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">{formatCurrency(s.unit_price, s.currency)}</span>
      ),
    },
    {
      header: "Total",
      render: (s: Sale) => (
        <span className="text-sm font-semibold text-[var(--color-success)] tabular-nums">{formatCurrency(s.total_amount, s.currency)}</span>
      ),
    },
    {
      header: "Actions",
      render: (s: Sale) => (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditTarget(s)}>Edit</Button>
          {isSuperAdmin && (
            <Button size="sm" variant="danger" onClick={() => setDeleteTarget(s)}>Delete</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Sales"
        description="Revenue from all platforms"
        action={<Button onClick={() => setAddOpen(true)}>+ Add Sale</Button>}
      />
      <DataTable columns={columns} rows={sales} keyField="id" emptyMessage="No sales yet. Add your first sale." />
      <AddSaleModal open={addOpen} onClose={() => setAddOpen(false)} />
      <EditSaleModal sale={editTarget} onClose={() => setEditTarget(null)} />
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Sale"
        description={`This will permanently delete "${deleteTarget?.product_name}". This action cannot be undone.`}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
