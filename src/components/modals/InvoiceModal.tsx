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
import { computeBulkTotals } from "@/lib/utils/invoiceMath";
import { formatCurrency } from "@/lib/utils/currency";
import type { Sale, Expense, Purchase } from "@/types";

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

// For sales: returns per-currency BulkTotals (subtotal, shipping, vat, grandTotal).
// For expenses/purchases: returns a simple per-currency amount map (no shipping).
function salesTotalsByCurrency(sales: Sale[]): Record<string, ReturnType<typeof computeBulkTotals>> {
  const byCurrency: Record<string, Sale[]> = {};
  sales.forEach((s) => { (byCurrency[s.currency] ??= []).push(s); });
  return Object.fromEntries(
    Object.entries(byCurrency).map(([cur, group]) => [cur, computeBulkTotals(group)])
  );
}

function simpleTotalsByCurrency(items: Expense[] | Purchase[], type: "expense" | "purchase"): Record<string, number> {
  const byCurrency: Record<string, number> = {};
  items.forEach((item) => {
    const amount = type === "expense" ? (item as Expense).amount : (item as Purchase).total_amount;
    byCurrency[item.currency] = (byCurrency[item.currency] ?? 0) + amount;
  });
  return byCurrency;
}

export function InvoiceModal(props: Props) {
  const { open, type, items, onClose, onSuccess } = props;
  const [generating, setGenerating] = useState(false);

  const companyProfile = useAppSelector((s) => s.companyProfile.profile);
  const noCompany = !companyProfile?.name?.trim();

  // Compute preview totals — sales get full Subtotal/Shipping/VAT/GrandTotal breakdown;
  // expenses/purchases keep their existing simple currency→amount map.
  const salesTotals = type === "sale" ? salesTotalsByCurrency(items as Sale[]) : null;
  const simpleTotals = type !== "sale" ? simpleTotalsByCurrency(items as Expense[] | Purchase[], type) : null;

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

          {/* Sales: show Subtotal / Shipping / VAT / Grand Total per currency */}
          {salesTotals && Object.entries(salesTotals).map(([cur, t]) => (
            <div key={cur} className="space-y-0.5">
              <SummaryRow label={`Subtotal (${cur})`} value={formatCurrency(t.subtotal, cur as "EUR" | "USD" | "GBP")} />
              <SummaryRow label={`Shipping (${cur})`} value={formatCurrency(t.shipping, cur as "EUR" | "USD" | "GBP")} />
              <SummaryRow label={`VAT (${cur})`} value={formatCurrency(t.vat, cur as "EUR" | "USD" | "GBP")} />
              <SummaryRow label={`Grand Total (${cur})`} value={formatCurrency(t.grandTotal, cur as "EUR" | "USD" | "GBP")} />
            </div>
          ))}

          {/* Expenses / Purchases: simple per-currency total */}
          {simpleTotals && Object.entries(simpleTotals).map(([cur, total]) => (
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
