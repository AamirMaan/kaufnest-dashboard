"use client";

import { useState } from "react";
import { FileDown, AlertCircle, Plus, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useAppSelector } from "@/store/hooks";
import {
  generateSalesInvoice,
  generateExpensesInvoice,
  generatePurchasesInvoice,
  type InvoiceOptions,
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

const EMPTY_OPTS: InvoiceOptions = { customerName: "", customerAddress: "", extraFields: [] };

export function InvoiceModal(props: Props) {
  const { open, type, items, onClose, onSuccess } = props;
  const [generating, setGenerating] = useState(false);
  const [opts, setOpts] = useState<InvoiceOptions>(EMPTY_OPTS);

  const companyProfile = useAppSelector((s) => s.companyProfile.profile);
  const noCompany = !companyProfile?.name?.trim();
  const byCurrency = totals(items, type);

  const typeLabel =
    type === "sale" ? "Sales Invoice" : type === "expense" ? "Expense Report" : "Purchase Report";

  function addExtraField() {
    setOpts((prev) => ({ ...prev, extraFields: [...prev.extraFields, { label: "", value: "" }] }));
  }

  function updateExtraField(index: number, key: "label" | "value", val: string) {
    setOpts((prev) => {
      const next = prev.extraFields.map((f, i) => (i === index ? { ...f, [key]: val } : f));
      return { ...prev, extraFields: next };
    });
  }

  function removeExtraField(index: number) {
    setOpts((prev) => ({ ...prev, extraFields: prev.extraFields.filter((_, i) => i !== index) }));
  }

  async function handleGenerate() {
    if (!companyProfile) return;
    setGenerating(true);
    const cleanedOpts: InvoiceOptions = {
      ...opts,
      extraFields: opts.extraFields.filter((f) => f.label.trim() || f.value.trim()),
    };
    try {
      if (type === "sale") await generateSalesInvoice(items as Sale[], companyProfile, cleanedOpts);
      else if (type === "expense") await generateExpensesInvoice(items as Expense[], companyProfile, cleanedOpts);
      else await generatePurchasesInvoice(items as Purchase[], companyProfile, cleanedOpts);
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

        {/* Customer Information */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
            Customer Information
          </p>
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Customer Name
              </label>
              <input
                type="text"
                value={opts.customerName}
                onChange={(e) => setOpts((prev) => ({ ...prev, customerName: e.target.value }))}
                placeholder="e.g. John Doe"
                className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Address
              </label>
              <textarea
                rows={2}
                value={opts.customerAddress}
                onChange={(e) => setOpts((prev) => ({ ...prev, customerAddress: e.target.value }))}
                placeholder="Street, City, ZIP"
                className="w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-none"
              />
            </div>
          </div>
        </div>

        {/* Additional Fields */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
            Additional Fields
          </p>
          <div className="space-y-1.5">
            {opts.extraFields.map((field, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={field.label}
                  onChange={(e) => updateExtraField(i, "label", e.target.value)}
                  placeholder="Label"
                  className="flex-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
                <input
                  type="text"
                  value={field.value}
                  onChange={(e) => updateExtraField(i, "value", e.target.value)}
                  placeholder="Value"
                  className="flex-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-base)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
                <button
                  type="button"
                  onClick={() => removeExtraField(i)}
                  className="p-1.5 rounded-[var(--radius-btn)] text-[var(--color-text-faint)] hover:text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)] transition-colors"
                  title="Remove field"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addExtraField}
              className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-base)] transition-colors py-0.5"
            >
              <Plus size={13} />
              Add Field
            </button>
          </div>
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
