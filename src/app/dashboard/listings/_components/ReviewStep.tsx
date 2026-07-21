"use client";

import { formatCurrency } from "@/lib/utils/currency";
import type { DraftFormState } from "../_lib/wizardValidation";

interface Props {
  draft: DraftFormState;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-(--color-text-muted)">{label}</span>
      <span className="text-(--color-text-strong) font-medium">{value}</span>
    </div>
  );
}

export function ReviewStep({ draft }: Props) {
  const price = Number(draft.price) || 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-(--color-text-muted)">
        Review the listing before publishing. You can still go back and change anything.
      </p>

      {draft.image_urls[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={draft.image_urls[0]} alt="" className="h-24 w-24 rounded object-cover" />
      )}

      <div className="rounded-(--radius-card) border border-(--color-border) divide-y divide-(--color-border-subtle) px-4">
        <Row label="Source" value={draft.source_type === "inventory" ? "Inventory product" : "Dropship"} />
        <Row label="Title" value={draft.title} />
        <Row label="Price" value={formatCurrency(price, draft.currency)} />
        <Row label="Quantity" value={draft.quantity} />
        <Row label="Condition" value={draft.condition} />
        <Row label="Category" value={draft.category_name || draft.category_id} />
        <Row label="Images" value={`${draft.image_urls.length} uploaded`} />
      </div>
    </div>
  );
}
