"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Loading spinner / error + Retry shared by the /admin/plans pages. */
export function PlanCatalogStatus({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm text-(--color-danger)">{error}</p>
        <Button variant="secondary" onClick={onRetry}>Retry</Button>
      </div>
    );
  }
  return (
    <p className="flex items-center justify-center gap-2 text-sm text-(--color-text-muted) py-8">
      <Loader2 size={16} className="animate-spin" />
      Loading plans…
    </p>
  );
}
