// Stub — replaced by Task 5 implementation
import type { Currency } from "@/types";

interface RecordTransferModalProps {
  platform: "ebay" | "amazon";
  currency: Currency;
  pendingBalance: number;
  onClose: () => void;
  onSaved: () => void;
}

export function RecordTransferModal(_props: RecordTransferModalProps) {
  return null;
}
