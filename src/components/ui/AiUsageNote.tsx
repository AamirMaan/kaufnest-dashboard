"use client";

import { useEffect, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { hasAiFeatures } from "@/lib/utils/planGating";

interface AiUsage {
  limit: number;
  tenantUsed: number;
  mine: { calls: number };
  /** Present only for admin/super_admin callers — the route decides, not us. */
  perUser?: Array<{ userId: string; name: string; calls: number }>;
}

interface Props {
  /** Bump to re-read usage after an AI call. Optional so the component still
   *  works as a plain mount-time read anywhere else. */
  refreshToken?: number;
}

export function AiUsageNote({ refreshToken = 0 }: Props) {
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
  const aiEnabled = useAppSelector((s) => s.currentUser.aiEnabled);
  const aiVisible = !!tenantPlan && hasAiFeatures(tenantPlan) && aiEnabled;

  const [usage, setUsage] = useState<AiUsage | null>(null);

  useEffect(() => {
    if (!aiVisible) return;
    let cancelled = false;
    // Every setState below sits after an await, so nothing runs synchronously
    // in the effect body (react-hooks/set-state-in-effect).
    (async () => {
      try {
        const res = await fetch("/api/listings/ai/usage");
        const json = await res.json();
        if (cancelled || !res.ok) return;
        setUsage(json as AiUsage);
      } catch {
        // A usage read is informational — a failure must never surface as a
        // toast or block the form. The note simply stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aiVisible, refreshToken]);

  if (!aiVisible || !usage) return null;

  const teamNote =
    usage.tenantUsed !== usage.mine.calls
      ? ` Your team has used ${usage.tenantUsed} in total.`
      : "";

  return (
    <div className="space-y-1 text-xs text-(--color-text-muted)">
      <p>
        You&apos;ve used {usage.mine.calls} of your team&apos;s {usage.limit} AI generations
        this month.
        {teamNote}
      </p>
      {usage.perUser && usage.perUser.length > 0 && (
        <ul className="space-y-0.5 pl-4">
          {usage.perUser.map((row) => (
            <li key={row.userId} className="list-disc">
              {row.name} — {row.calls}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
