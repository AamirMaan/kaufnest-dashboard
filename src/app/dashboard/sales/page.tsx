"use client";

import { useAppSelector } from "@/store/hooks";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PlatformBadge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date";
import type { Sale } from "@/types";
import Link from "next/link";

export default function SalesPage() {
  const sales = useAppSelector((s) => s.sales.items);

  const columns = [
    {
      header: "Date",
      render: (s: Sale) => (
        <span className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">
          {formatDate(s.date)}
        </span>
      ),
    },
    {
      header: "Product",
      render: (s: Sale) => (
        <span className="text-sm font-medium text-[var(--color-text-strong)]">
          {s.product_name}
        </span>
      ),
    },
    {
      header: "Platform",
      render: (s: Sale) => <PlatformBadge platform={s.platform} />,
    },
    {
      header: "Qty",
      render: (s: Sale) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">
          {s.quantity}
        </span>
      ),
    },
    {
      header: "Unit Price",
      render: (s: Sale) => (
        <span className="text-sm text-[var(--color-text-base)] tabular-nums">
          {formatCurrency(s.unit_price, s.currency)}
        </span>
      ),
    },
    {
      header: "Total",
      render: (s: Sale) => (
        <span className="text-sm font-semibold text-[var(--color-success)] tabular-nums">
          {formatCurrency(s.total_amount, s.currency)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Sales"
        description="Revenue from all platforms"
        action={
          <Link href="/dashboard/sales/new">
            <Button>+ Add Sale</Button>
          </Link>
        }
      />
      <DataTable
        columns={columns}
        rows={sales}
        keyField="id"
        emptyMessage="No sales yet. Add your first sale."
      />
    </div>
  );
}
