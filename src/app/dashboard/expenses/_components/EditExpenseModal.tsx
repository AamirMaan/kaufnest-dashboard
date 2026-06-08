"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Checkbox, Row } from "@/components/ui/FormFields";
import { useAppDispatch } from "@/store/hooks";
import { updateExpense } from "../_store/expensesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { readInvoiceSettings } from "@/lib/hooks/useInvoiceSettings";
import { vatAmountFromGross } from "@/lib/utils/currency";
import type { ExpenseCategory, Currency, Expense } from "@/types";

const CATEGORIES: ExpenseCategory[] = [
  "shipping", "advertising", "software", "office",
  "inventory", "tax", "salary", "other",
];
const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

interface Props {
  expense: Expense | null;
  onClose: () => void;
  onSuccess?: () => void;
}

interface FormState {
  title: string;
  amount: string;
  currency: Currency;
  category: ExpenseCategory;
  vendor: string;
  date: string;
  description: string;
  vat_included: boolean;
  vat_rate: string;
  reason: string;
}

function expenseToForm(e: Expense): FormState {
  return {
    title: e.title,
    amount: String(e.amount),
    currency: e.currency,
    category: e.category,
    vendor: e.vendor ?? "",
    date: e.date,
    description: e.description ?? "",
    vat_included: e.vat_rate != null,
    vat_rate: e.vat_rate != null ? String(e.vat_rate) : String(readInvoiceSettings().vatRate),
    reason: "",
  };
}

const blankForm: FormState = {
  title: "", amount: "", currency: "EUR", category: "other", vendor: "", date: "",
  description: "", vat_included: false, vat_rate: "0", reason: "",
};

export function EditExpenseModal({ expense, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState<FormState>(() => (expense ? expenseToForm(expense) : blankForm));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const amount = parseFloat(form.amount) || 0;
  const vatRate = parseFloat(form.vat_rate) || 0;
  const vatAmount = form.vat_included ? vatAmountFromGross(amount, vatRate) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!expense) return;
    if (!form.title.trim()) return setError("Title is required.");
    if (!(amount > 0)) return setError("Amount must be greater than 0.");
    if (!form.reason.trim()) return setError("Reason for edit is required.");
    setError(null);
    setSaving(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error: dbError } = await supabase
      .from("expenses")
      .update({
        title: form.title.trim(),
        amount,
        currency: form.currency,
        category: form.category,
        vendor: form.vendor.trim() || null,
        date: form.date,
        description: form.description.trim() || null,
        vat_rate: form.vat_included ? vatRate : null,
        vat_amount: form.vat_included ? vatAmount : null,
      })
      .eq("id", expense.id)
      .select()
      .single<Expense>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(updateExpense(data));

    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "update",
      entityType: "expense",
      entityId: expense.id,
      metadata: {
        before: { title: expense.title, amount: expense.amount, category: expense.category, vendor: expense.vendor, currency: expense.currency, date: expense.date, vat_rate: expense.vat_rate, vat_amount: expense.vat_amount },
        after:  { title: data.title, amount: data.amount, category: data.category, vendor: data.vendor, currency: data.currency, date: data.date, vat_rate: data.vat_rate, vat_amount: data.vat_amount },
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
      title="Edit Expense"
      open={!!expense}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="edit-expense-form" disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </>
      }
    >
      <form id="edit-expense-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <Field label="Title" required>
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} required />
        </Field>

        <Row>
          <Field label="Category" required>
            <Select value={form.category} onChange={(e) => set("category", e.target.value as ExpenseCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date" required>
            <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required />
          </Field>
        </Row>

        <Row>
          <Field label="Amount" required>
            <Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} required />
          </Field>
          <Field label="Currency" required>
            <Select value={form.currency} onChange={(e) => set("currency", e.target.value as Currency)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </Row>

        <Field label="Vendor">
          <Input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Optional" />
        </Field>

        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border)] p-4">
          <Checkbox
            label="Amount includes VAT"
            checked={form.vat_included}
            onChange={(e) => set("vat_included", e.target.checked)}
          />
          {form.vat_included && (
            <>
              <Field label="VAT Rate (%)">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={form.vat_rate}
                  onChange={(e) => set("vat_rate", e.target.value)}
                />
              </Field>
              {amount > 0 && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Net {form.currency} {(amount - vatAmount).toFixed(2)} · VAT {form.currency} {vatAmount.toFixed(2)} · Gross {form.currency} {amount.toFixed(2)}
                </p>
              )}
            </>
          )}
        </div>

        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional notes…" />
        </Field>

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
