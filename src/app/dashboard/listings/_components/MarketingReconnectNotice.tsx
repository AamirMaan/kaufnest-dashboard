import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/** Shown in place of the multi-buy and advertising controls when the
 *  tenant's eBay token lacks the sell.marketing scope. */
export function MarketingReconnectNotice() {
  return (
    <div className="flex items-start gap-2 rounded-(--radius-btn) border border-[var(--color-warning-text)]/30 bg-(--color-warning-bg) px-3 py-2 text-sm text-(--color-warning-text)">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <p>
        Reconnect eBay to turn on advertising and multi-buy discounts.{" "}
        <Link href="/dashboard/integrations" className="font-medium underline">
          Go to Integrations
        </Link>
      </p>
    </div>
  );
}
