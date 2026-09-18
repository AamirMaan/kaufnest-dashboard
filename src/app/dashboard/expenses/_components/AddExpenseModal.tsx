"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Checkbox, Row } from "@/components/ui/FormFields";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addExpense } from "../_store/expensesSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { vatAmountFromGross } from "@/lib/utils/currency";
import { ReceiptUploader } from "./ReceiptUploader";
import type { ExpenseCategory, Currency, Expense, ExpenseReceipt } from "@/types";

const CATEGORIES: ExpenseCategory[] = [
  "shipping", "advertising", "software", "office",
  "inventory", "tax", "salary", "other",
];
const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: (title: string) => void;
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
  vendor_vat_number: string;
  invoice_number: string;
  receipts: ExpenseReceipt[];
}

const today = () => new Date().toISOString().slice(0, 10);

function makeDefaults(defaultVatRate: number): FormState {
  return {
    title: "",
    amount: "",
    currency: "EUR",
    category: "other",
    vendor: "",
    date: today(),
    description: "",
    vat_included: false,
    vat_rate: String(defaultVatRate),
    vendor_vat_number: "",
    invoice_number: "",
    receipts: [],
  };
}

export function AddExpenseModal({ open, onClose, onSuccess }: Props) {
  const dispatch = useAppDispatch();
  const defaultVatRate = useAppSelector((s) => s.companyProfile.profile?.vat_rate ?? 19);
  const [form, setForm] = useState<FormState>(() => makeDefaults(defaultVatRate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptsBusy, setReceiptsBusy] = useState(false);

  // Set the moment a receipt-triggered early insert succeeds (see
  // `handleExpenseCreated`); read synchronously by `handleSubmit`/
  // `handleClose` so a save/cancel that races the insert never misses it.
  // `createdExpenseId` (state) mirrors it purely so it can be passed down as
  // `ReceiptUploader`'s `expenseId` prop and trigger a re-render.
  const createdIdRef = useRef<string | null>(null);
  const [createdExpenseId, setCreatedExpenseId] = useState<string | null>(null);

  // True once the modal has been dismissed (Cancel/backdrop/X/Escape — all
  // funnel through handleClose) while a receipt-triggered early insert was
  // still in flight. Checked by `handleExpenseCreated` right after its
  // insert resolves, so an since-abandoned row is deleted immediately
  // instead of surviving as a permanent, un-audited orphan — Modal.tsx
  // deliberately allows closing at any time (AGENTS.md: "never build one
  // that traps the user"), so the fix has to live on this side, not by
  // blocking the close.
  const closedRef = useRef(false);

  // The modal never unmounts (page.tsx only toggles `open`) — reset the
  // flag whenever it opens again, or every later Add session would find it
  // stuck `true` from the first close.
  useEffect(() => {
    if (open) closedRef.current = false;
  }, [open]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // An expense amount may be NEGATIVE (a credit note) or ZERO — only a
  // NON-NUMERIC entry is invalid. The importer creates negative expenses from
  // a German VAT ledger's credit-note lines (migration 032 dropped
  // `expenses_amount_check`), and it would be incoherent for the app to import
  // a shape it refuses to let a user type by hand. Do not reintroduce an
  // `amount > 0` guard here or in `EditExpenseModal`.
  const parsedAmount = parseFloat(form.amount);
  const amountIsValid = Number.isFinite(parsedAmount);
  const amount = amountIsValid ? parsedAmount : 0;
  const vatRate = parseFloat(form.vat_rate) || 0;
  // `vatAmountFromGross` is linear in `gross`, so a negative gross yields
  // negative input tax — the correct sign for a credit note.
  const vatAmount = form.vat_included ? vatAmountFromGross(amount, vatRate) : 0;

  function buildRow() {
    return {
      title: form.title.trim(),
      amount,
      currency: form.currency,
      category: form.category,
      vendor: form.vendor.trim() || null,
      date: form.date,
      description: form.description.trim() || null,
      vat_rate: form.vat_included ? vatRate : null,
      vat_amount: form.vat_included ? vatAmount : null,
      vendor_vat_number: form.vendor_vat_number.trim() || null,
      invoice_number: form.invoice_number.trim() || null,
      receipts: form.receipts,
    };
  }

  // Wired to ReceiptUploader as `onExpenseCreated`: only called when the
  // user attaches a receipt before clicking "Add Expense" — the row needs a
  // real id for the receipt's Storage path (`_lib/receiptPath.ts`). Uses
  // whatever the form holds right now, under the same two guards
  // `handleSubmit` runs. `handleSubmit` later UPDATEs this same row instead
  // of inserting a second one; `handleClose` deletes it if the user never
  // actually submits — see that function's comment.
  async function handleExpenseCreated(): Promise<string> {
    if (createdIdRef.current) return createdIdRef.current;
    if (!form.title.trim()) throw new Error("Enter a title before attaching a receipt.");
    if (!amountIsValid) throw new Error("Enter a valid amount before attaching a receipt.");

    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error: dbError } = await supabase
      .from("expenses")
      .insert({ ...buildRow(), created_by: user!.id })
      .select()
      .single<Expense>();
    if (dbError) throw new Error(dbError.message);

    // The modal may have been closed (Cancel/backdrop/X/Escape) while this
    // insert was in flight. handleClose's own cleanup only deletes a row it
    // can already see via createdIdRef, which was still null at that point
    // — delete this one ourselves instead of leaving a permanent,
    // un-audited orphan.
    if (closedRef.current) {
      await supabase.from("expenses").delete().eq("id", data.id);
      throw new Error("The expense was closed before the receipt could be saved.");
    }

    createdIdRef.current = data.id;
    setCreatedExpenseId(data.id);
    return data.id;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return setError("Title is required.");
    if (!amountIsValid) return setError("Amount must be a number.");
    setError(null);
    setSaving(true);

    const supabase = await createTenantClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error: dbError } = createdIdRef.current
      ? await supabase
          .from("expenses")
          .update(buildRow())
          .eq("id", createdIdRef.current)
          .select()
          .single<Expense>()
      : await supabase
          .from("expenses")
          .insert({ ...buildRow(), created_by: user!.id })
          .select()
          .single<Expense>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(addExpense(data));

    const log = await writeAuditLog(supabase, {
      userId: user!.id,
      userEmail: user!.email ?? "",
      action: "create",
      entityType: "expense",
      entityId: data.id,
      metadata: { title: data.title, category: data.category, amount: data.amount },
    });
    if (log) dispatch(addAuditLog(log));

    createdIdRef.current = null;
    setCreatedExpenseId(null);
    setForm(makeDefaults(defaultVatRate));
    setSaving(false);
    onSuccess?.(data.title);
    onClose();
  }

  async function handleClose() {
    closedRef.current = true;

    // Orphan rule: a receipt attached before the rest of the form was
    // submitted creates the row early (see `handleExpenseCreated`). Closing
    // without submitting must not leave that partial row behind as a real,
    // permanently incomplete, un-audited expense — delete it. Its uploaded
    // receipt objects become orphaned Storage files with nothing pointing
    // at them; that's an accepted, pre-existing tradeoff (see
    // `ImageGrid.tsx`'s own removal comment), not a ledger-integrity
    // problem — nothing in the app ever reads a deleted expense's folder.
    if (createdIdRef.current) {
      const supabase = await createTenantClient();
      await supabase.from("expenses").delete().eq("id", createdIdRef.current);
      createdIdRef.current = null;
      setCreatedExpenseId(null);
    }
    setForm(makeDefaults(defaultVatRate));
    setError(null);
    onClose();
  }

  return (
    <Modal
      title="Add Expense"
      open={open}
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose} disabled={saving || receiptsBusy}>
            Cancel
          </Button>
          <Button type="submit" form="add-expense-form" disabled={saving || receiptsBusy}>
            {saving ? "Saving…" : "Add Expense"}
          </Button>
        </>
      }
    >
      <form id="add-expense-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <Field label="Title" required>
          <Input
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. Amazon Shipping Fee"
            required
          />
        </Field>

        <Row>
          <Field label="Category" required>
            <Select
              value={form.category}
              onChange={(e) => set("category", e.target.value as ExpenseCategory)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Date" required>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              required
            />
          </Field>
        </Row>

        <Row>
          <Field label="Amount" required>
            {/* No `min` — a credit note is a negative expense, and the
                browser's own constraint validation would otherwise block
                submit before `handleSubmit` ever runs. See the amount comment
                above. */}
            <Input
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="0.00"
              required
            />
          </Field>

          <Field label="Currency" required>
            <Select
              value={form.currency}
              onChange={(e) => set("currency", e.target.value as Currency)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </Row>

        <Field label="Vendor">
          <Input
            value={form.vendor}
            onChange={(e) => set("vendor", e.target.value)}
            placeholder="e.g. DHL, Google Ads…"
          />
        </Field>

        <Row>
          <Field label="Invoice Number">
            <Input
              value={form.invoice_number}
              onChange={(e) => set("invoice_number", e.target.value)}
              placeholder="e.g. RE-2024-001"
            />
          </Field>
          <Field label="Vendor VAT Number">
            <Input
              value={form.vendor_vat_number}
              onChange={(e) => set("vendor_vat_number", e.target.value)}
              placeholder="e.g. DE123456789"
            />
          </Field>
        </Row>

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
              {/* Gated on "is a number", not "> 0" — a credit note's breakdown
                  is exactly the one a user needs to see. */}
              {amountIsValid && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Net {form.currency} {(amount - vatAmount).toFixed(2)} · VAT {form.currency} {vatAmount.toFixed(2)} · Gross {form.currency} {amount.toFixed(2)}
                </p>
              )}
            </>
          )}
        </div>

        <Field label="Receipts">
          <ReceiptUploader
            receipts={form.receipts}
            setReceipts={(receipts) => set("receipts", receipts)}
            expenseId={createdExpenseId}
            onExpenseCreated={handleExpenseCreated}
            onBusyChange={setReceiptsBusy}
            disabled={saving}
          />
        </Field>

        <Field label="Description">
          <Textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Optional notes…"
          />
        </Field>
      </form>
    </Modal>
  );
}
