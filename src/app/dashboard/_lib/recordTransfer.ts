import type { Currency } from "@/types";

export type PayoutPlatform = "ebay" | "amazon";

export interface TransferForm {
  platform: PayoutPlatform | "";
  currency: Currency;
  amount: string;
  date: string;
  notes: string;
}

function parsedAmount(amount: string): number {
  const n = Number(amount);
  return Number.isFinite(n) ? n : 0;
}

function amountIsPositive(amount: string): boolean {
  return amount.trim() !== "" && parsedAmount(amount) > 0;
}

export function isTransferFormValid(f: TransferForm): boolean {
  return f.platform !== "" && amountIsPositive(f.amount) && f.date !== "";
}

export function transferInsertPayload(f: TransferForm, userId: string) {
  if (!isTransferFormValid(f) || f.platform === "") throw new Error("Invalid transfer form");
  return {
    platform: f.platform,
    amount: parsedAmount(f.amount),
    currency: f.currency,
    date: f.date,
    notes: f.notes.trim() || null,
    created_by: userId,
  };
}
