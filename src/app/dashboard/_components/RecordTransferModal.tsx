"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Row } from "@/components/ui/FormFields";
import { useAppDispatch } from "@/store/hooks";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatCurrency } from "@/lib/utils/currency";
import { useToast } from "@/components/ui/Toast";
import type { Currency, PlatformPayout } from "@/types";
import { isTransferFormValid, localDateISO, transferInsertPayload, type PayoutPlatform, type TransferForm } from "../_lib/recordTransfer";

interface Props {
  /** Fixed platform (Home's per-platform card). Omitted → the user picks one (Payouts page). */
  platform?: PayoutPlatform;
  /** Fixed when `platform` is given; otherwise the currency Select's default. */
  currency: Currency;
  /** Home only — prefills the amount and drives the over-transfer warning. */
  pendingBalance?: number;
  onClose: () => void;
  onSaved: (payout: PlatformPayout) => void;
}

const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];
const PLATFORM_LABELS: Record<PayoutPlatform, string> = { ebay: "eBay", amazon: "Amazon" };
const today = () => localDateISO(new Date());

export function RecordTransferModal({ platform, currency, pendingBalance, onClose, onSaved }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const [form, setForm] = useState<TransferForm>({
    platform: platform ?? "",
    currency,
    amount: pendingBalance !== undefined && pendingBalance > 0 ? pendingBalance.toFixed(2) : "",
    date: today(),
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const isFormValid = isTransferFormValid(form);
  const amountNum = Number(form.amount) || 0;
  const overTransfer = pendingBalance !== undefined && pendingBalance > 0 && amountNum > pendingBalance;
  const set = <K extends keyof TransferForm>(key: K, value: TransferForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid) return;
    setSaving(true);
    try {
      const supabase = await createTenantClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toastError("Session expired", "Please refresh and try again.");
        return;
      }
      const { data, error: dbError } = await supabase
        .from("platform_payouts")
        .insert(transferInsertPayload(form, user.id))
        .select()
        .single<PlatformPayout>();
      if (dbError || !data) {
        toastError("Failed to record transfer", "Please try again.");
        return;
      }
      // Best-effort: the payout is already saved, so an audit failure must not report it as failed.
      try {
        const log = await writeAuditLog(supabase, {
          userId: user.id,
          userEmail: user.email ?? "",
          action: "create",
          entityType: "payout",
          entityId: data.id,
          metadata: { after: data },
        });
        if (log) dispatch(addAuditLog(log));
      } catch {
        // audit trail is secondary
      }
      success("Transfer recorded", `${formatCurrency(data.amount, data.currency)} from ${PLATFORM_LABELS[data.platform]}.`);
      onSaved(data);
    } catch {
      toastError("Failed to record transfer", "Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={platform ? `Record ${PLATFORM_LABELS[platform]} Transfer` : "Record Transfer"}
      open
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="record-transfer-form" disabled={saving || !isFormValid}>
            {saving ? "Saving…" : "Record Transfer"}
          </Button>
        </>
      }
    >
      <form id="record-transfer-form" onSubmit={handleSubmit} className="space-y-4">
        {platform ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-sm text-[var(--color-text-base)]">
            <span className="font-medium">{PLATFORM_LABELS[platform]}</span>
            <span className="mx-2 text-[var(--color-text-faint)]">·</span>
            <span>{currency}</span>
            {pendingBalance !== undefined && (
              <>
                <span className="mx-2 text-[var(--color-text-faint)]">·</span>
                <span className="text-[var(--color-text-faint)]">Pending: {formatCurrency(pendingBalance, currency)}</span>
              </>
            )}
          </div>
        ) : (
          <Row>
            <Field label="Platform" required>
              <Select value={form.platform} onChange={(e) => set("platform", e.target.value as PayoutPlatform | "")} required>
                <option value="">Select platform…</option>
                <option value="ebay">eBay</option>
                <option value="amazon">Amazon</option>
              </Select>
            </Field>
            <Field label="Currency" required>
              <Select value={form.currency} onChange={(e) => set("currency", e.target.value as Currency)} required>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </Row>
        )}

        <Row>
          <Field label="Amount" required>
            <Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" required />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required />
          </Field>
        </Row>

        {overTransfer && pendingBalance !== undefined && (
          <p className="text-xs text-amber-600">
            This amount exceeds the current pending balance ({formatCurrency(pendingBalance, currency)}). The Pending
            tile will go negative — this is allowed if earlier payouts are outside the selected date range.
          </p>
        )}

        <Field label="Notes">
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional reference number or notes…" maxLength={500} />
        </Field>
      </form>
    </Modal>
  );
}
