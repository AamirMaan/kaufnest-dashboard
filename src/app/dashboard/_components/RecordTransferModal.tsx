"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea, Row } from "@/components/ui/FormFields";
import { useAppDispatch } from "@/store/hooks";
import { addPayout } from "@/store/slices/platformPayoutsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/currency";
import { useToast } from "@/components/ui/Toast";
import type { Currency, PlatformPayout } from "@/types";

interface Props {
  platform: "ebay" | "amazon";
  currency: Currency;
  pendingBalance: number;
  onClose: () => void;
  onSaved: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export function RecordTransferModal({
  platform,
  currency,
  pendingBalance,
  onClose,
  onSaved,
}: Props) {
  const dispatch = useAppDispatch();
  const { error: toastError } = useToast();
  const [amount, setAmount] = useState(
    pendingBalance > 0 ? pendingBalance.toFixed(2) : ""
  );
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = parseFloat(amount) || 0;
  const overTransfer = parsedAmount > pendingBalance && pendingBalance > 0;
  const platformLabel = platform === "ebay" ? "eBay" : "Amazon";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!(parsedAmount > 0)) return setError("Amount must be greater than 0.");
    if (!date) return setError("Date is required.");
    setError(null);
    setSaving(true);

    const supabase = await createTenantClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toastError("Session expired. Please refresh and try again.");
      setSaving(false);
      return;
    }

    const { data, error: dbError } = await supabase
      .from("platform_payouts")
      .insert({
        platform,
        amount: parsedAmount,
        currency,
        date,
        notes: notes.trim() || null,
        created_by: user.id,
      })
      .select()
      .single<PlatformPayout>();

    if (dbError) {
      toastError("Failed to record transfer. Please try again.");
      setSaving(false);
      return;
    }

    dispatch(addPayout(data));
    setSaving(false);
    onSaved();
  }

  return (
    <Modal
      title={`Record ${platformLabel} Transfer`}
      open
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="record-transfer-form" disabled={saving}>
            {saving ? "Saving…" : "Record Transfer"}
          </Button>
        </>
      }
    >
      <form id="record-transfer-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        {/* Read-only platform + currency context */}
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-sm text-[var(--color-text-base)]">
          <span className="font-medium">{platformLabel}</span>
          <span className="mx-2 text-[var(--color-text-faint)]">·</span>
          <span>{currency}</span>
          <span className="mx-2 text-[var(--color-text-faint)]">·</span>
          <span className="text-[var(--color-text-faint)]">
            Pending: {formatCurrency(pendingBalance, currency)}
          </span>
        </div>

        <Row>
          <Field label="Amount" required>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </Field>

          <Field label="Date" required>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </Field>
        </Row>

        {overTransfer && (
          <p className="text-xs text-amber-600">
            This amount exceeds the current pending balance (
            {formatCurrency(pendingBalance, currency)}). The Pending tile will go
            negative — this is allowed if earlier payouts are outside the selected
            date range.
          </p>
        )}

        <Field label="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional reference number or notes…"
            maxLength={500}
          />
        </Field>
      </form>
    </Modal>
  );
}
