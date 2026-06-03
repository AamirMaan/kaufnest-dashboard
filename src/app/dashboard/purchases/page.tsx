"use client";

import { useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { AddPurchaseModal } from "@/components/modals/AddPurchaseModal";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import type { Purchase } from "@/types";

export default function PurchasesPage() {
  const purchases = useAppSelector((s) => s.purchases.items);
  const [open, setOpen] = useState(false);

  const columns = [
    {
      header: "Date",
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">
          {formatDate(p.date)}
        </span>
      ),
    },
    {
      header: "Product",
      render: (p: Purchase) => (
        <span className="text-sm font-medium text-[var(--color-text-strong)]">
          {p.product_name}
        </span>
      ),
    },
    {
      header: "Vendor",
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-muted)]">
          {p.vendor ?? "—"}
        </span>
      ),
    },
    {
      header: "Qty",
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">
          {p.quantity}
        </span>
      ),
    },
    {
      header: "Unit Price",
      render: (p: Purchase) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">
          {formatCurrency(p.unit_price, p.currency)}
        </span>
      ),
    },
    {
      header: "Total",
      render: (p: Purchase) => (
        <span className="text-sm font-semibold text-[var(--color-warning)] tabular-nums">
          {formatCurrency(p.total_amount, p.currency)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Inventory and stock purchases"
        action={<Button onClick={() => setOpen(true)}>+ Add Purchase</Button>}
      />
      <DataTable
        columns={columns}
        rows={purchases}
        keyField="id"
        emptyMessage="No purchases yet. Add your first purchase."
      />
      <AddPurchaseModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
