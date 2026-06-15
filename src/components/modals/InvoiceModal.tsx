"use client";

import { useState } from "react";
import { FileDown, AlertCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useAppSelector } from "@/store/hooks";
import {
  generateSalesInvoice,
  generateExpensesInvoice,
  generatePurchasesInvoice,
} from "@/lib/utils/generateInvoice";
import { formatCurrency } from "@/lib/utils/currency";
import type { Sale, Expense, Purchase } from "@/types";

type InvoiceType = "sale" | "expense" | "purchase";

interface SalesInvoiceProps {
  type: "sale";
  items: Sale[];
  onClose: () => void;
}
interface ExpenseInvoiceProps {
  type: "expense";
  items: Expense[];
  onClose: () => void;
}
interface PurchaseInvoiceProps {
  type: "purchase";
  items: Purchase[];
  onClose: () => void;
}

type Props = (SalesInvoiceProps | ExpenseInvoiceProps | PurchaseInvoiceProps) & {
  open: boolean;
  onSuccess?: () => void;
};

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-[var(--color-border-subtle)] last:border-0">
      <span className="text-sm text-[var(--color-text-muted)]">{label}</span>
      <span className="text-sm font-semibold text-[var(--color-text-strong)]">{value}</span>
    </div>
  );
}

function totals(items: Sale[] | Expense[] | Purchase[], type: InvoiceType) {
  const byCurrency: Record<string, number> = {};
  items.forEach((item) => {
    const amount =
      type === "expense"
        ? (item as Expense).amount
        : (item as Sale | Purchase).total_amount;
    byCurrency[item.currency] = (byCurrency[item.currency] ?? 0) + amount;
  });
  return byCurrency;
}

export function InvoiceModal(props: Props) {
  const { open, type, items, onClose, onSuccess } = props;
  const [generating, setGenerating] = useState(false);

  const companyProfile = useAppSelector((s) => s.companyProfile.profile);
  const noCompany = !companyProfile?.name?.trim();
  const byCurrency = totals(items, type);

  const typeLabel =
    type === "sale" ? "Sales Invoice" : type === "expense" ? "Expense Report" : "Purchase Report";

  async function handleGenerate() {
    if (!companyProfile) return;
    setGenerating(true);
    try {
      if (type === "sale") await generateSalesInvoice(items as Sale[], companyProfile);
      else if (type === "expense") await generateExpensesInvoice(items as Expense[], companyProfile);
      else await generatePurchasesInvoice(items as Purchase[], companyProfile);
      onSuccess?.();
    } finally {
      setGenerating(false);
      onClose();
    }
  }

  return (
    <Modal
      title={`Generate ${typeLabel}`}
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={generating}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={generating || items.length === 0 || !companyProfile}>
            <FileDown size={15} />
            {generating ? "Generating…" : "Download PDF"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {noCompany && (
          <div className="flex items-start gap-2 rounded-[var(--radius-btn)] bg-[var(--color-warning-bg)] border border-orange-200 px-3 py-2.5 text-sm text-[var(--color-warning-text)]">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
            <span>
              Your company name is not set.{" "}
              <a href="/dashboard/settings" className="underline font-medium cursor-pointer">
                Configure invoice settings
              </a>{" "}
              before generating.
            </span>
          </div>
        )}

        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 space-y-1">
          <SummaryRow label="Records included" value={String(items.length)} />
          {Object.entries(byCurrency).map(([cur, total]) => (
            <SummaryRow
              key={cur}
              label={`Total (${cur})`}
              value={formatCurrency(total, cur as "EUR" | "USD" | "GBP")}
            />
          ))}
          {items.length === 0 && (
            <p className="text-sm text-[var(--color-text-faint)] italic py-1">
              No records match the current filters.
            </p>
          )}
        </div>

        <p className="text-xs text-[var(--color-text-muted)]">
          The PDF will include all{" "}
          <span className="font-semibold">{items.length}</span> currently filtered record
          {items.length !== 1 ? "s" : ""}. Use the table filters to narrow down before
          generating.
        </p>
      </div>
    </Modal>
  );
}
