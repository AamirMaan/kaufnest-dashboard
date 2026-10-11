"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { getMaxAccountsPerPlatform, canAddAccount, type PlanEntitlements } from "@/lib/plans/entitlements";
import { accountState, canResumeAccount, connectedCount } from "@/lib/utils/activeAccounts";
import { ConnectionCard } from "./ConnectionCard";
import { needsReconnectBanner, platformHeading } from "../_lib/accountSummary";
import type { IntegrationPlatform, PlatformConnection } from "@/types";

const LABELS: Record<IntegrationPlatform, string> = { ebay: "eBay", amazon: "Amazon" };

export function PlatformAccountsSection({ platform, connections, ent, canManage }: {
  platform: IntegrationPlatform;
  connections: PlatformConnection[];
  ent: PlanEntitlements;
  canManage: boolean;
}) {
  const label = LABELS[platform];
  const mine = connections.filter((c) => c.platform === platform);
  const cap = getMaxAccountsPerPlatform(ent);
  const used = connectedCount(connections, platform);
  const atCap = !canAddAccount(ent, used);
  // A pre-056 row must be reconnected from its own card first; the connect
  // route refuses "Add account" until then (INTEGRATION_LEGACY_RECONNECT).
  const legacyPending = needsReconnectBanner(mine);
  const canAdd = !atCap && !legacyPending;

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
      {canManage && legacyPending && !atCap && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Reconnect your existing {label} account below before adding another.
        </p>
      )}
      {canManage && atCap && (
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
              state={accountState(connections, c.id, ent)}
              canResume={canResumeAccount(connections, c.id, ent)}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </section>
  );
}
