"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { getMaxAccountsPerPlatform, canAddAccount } from "@/lib/utils/planGating";
import { accountState, canResumeAccount, connectedCount } from "@/lib/utils/activeAccounts";
import { ConnectionCard } from "./ConnectionCard";
import { platformHeading } from "../_lib/accountSummary";
import type { IntegrationPlatform, PlatformConnection, TenantPlan } from "@/types";

const LABELS: Record<IntegrationPlatform, string> = { ebay: "eBay", amazon: "Amazon" };

export function PlatformAccountsSection({ platform, connections, plan, canManage }: {
  platform: IntegrationPlatform;
  connections: PlatformConnection[];
  plan: TenantPlan;
  canManage: boolean;
}) {
  const label = LABELS[platform];
  const mine = connections.filter((c) => c.platform === platform);
  const cap = getMaxAccountsPerPlatform(plan);
  const used = connectedCount(connections, platform);
  const canAdd = canAddAccount(plan, used);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--color-text-strong)]">{platformHeading(label, used, cap)}</h2>
        {canManage && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!canAdd}
            onClick={() => window.location.assign(`/api/integrations/${platform}/connect`)}
          >
            Add {label} account
          </Button>
        )}
      </div>
      {canManage && !canAdd && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Your plan includes {cap} {label} account{cap === 1 ? "" : "s"}.{" "}
          <Link href="/dashboard/settings" className="font-medium text-[var(--color-primary)] hover:underline">
            Upgrade for more →
          </Link>
        </p>
      )}
      {mine.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-text-muted)]">
          No {label} accounts connected yet.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {mine.map((c) => (
            <ConnectionCard
              key={c.id}
              connection={c}
              state={accountState(connections, c.id, plan)}
              canResume={canResumeAccount(connections, c.id, plan)}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </section>
  );
}
