"use client";

import Link from "next/link";
import { Boxes } from "lucide-react";
import { usePlan } from "@/store/usePlan";

export function AdvancedInventoryUpsellCard() {
  const { availability } = usePlan();
  return (
    <div className="mb-6 flex items-start gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4">
      <Boxes size={18} className="mt-0.5 shrink-0 text-(--color-text-muted)" aria-hidden />
      <div>
        <h2 className="text-base font-semibold text-(--color-text-strong)">Batches &amp; locations</h2>
        <p className="mt-1 text-sm text-(--color-text-muted)">
          Track each batch&apos;s landed cost, stock per warehouse (including Amazon FBA), and FIFO cost of goods
          on every order. {availability("advancedInventory", "Batches, locations and FIFO costing")}
        </p>
        <Link
          href="/dashboard/settings"
          className="mt-2 inline-block text-sm font-medium text-(--color-primary) hover:underline"
        >
          View plans &amp; billing →
        </Link>
      </div>
    </div>
  );
}
