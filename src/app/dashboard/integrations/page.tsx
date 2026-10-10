"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { useAppSelector } from "@/store/hooks";
import { useAccess } from "@/store/useAccess";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import { PlatformAccountsSection } from "./_components/PlatformAccountsSection";
import { needsReconnectBanner } from "./_lib/accountSummary";
import { accountState } from "@/lib/utils/activeAccounts";
import { integrationErrorMessage } from "@/lib/utils/integrationErrors";
import type { IntegrationPlatform } from "@/types";

const PLATFORMS: IntegrationPlatform[] = ["ebay", "amazon"];
const PLATFORM_LABELS: Record<IntegrationPlatform, string> = {
  ebay: "eBay",
  amazon: "Amazon",
};

function IntegrationsContent() {
  const { success, error: toastError } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useAccess();
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
  const connections = useAppSelector((s) => s.integrations.connections);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const err = searchParams.get("error");

    if (connected && (connected === "ebay" || connected === "amazon")) {
      success(`${PLATFORM_LABELS[connected]} account connected`, "You can now sync orders from this platform.");
      // Re-fetch server data so the connection card reflects the new status
      router.refresh();
    } else if (err) {
      toastError("Connection failed", integrationErrorMessage(err, err));
    }
  }, [searchParams, success, toastError, router]);

  const canManage = can("integrations", 2);

  if (!tenantPlan || !hasPlatformIntegrations(tenantPlan)) {
    return (
      <div>
        <PageHeader
          title="Integrations"
          description="Connect eBay and Amazon to sync orders automatically"
        />
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h2 className="text-sm font-semibold text-[var(--color-text-strong)]">
            Upgrade to unlock integrations
          </h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Automatic eBay and Amazon order syncing is available on the Pro and Business plans.
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-4 inline-block text-sm font-medium text-[var(--color-primary)] hover:underline"
          >
            View plans &amp; billing →
          </Link>
        </div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div>
        <PageHeader
          title="Integrations"
          description="Connect eBay and Amazon to sync orders automatically"
        />
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <p className="text-sm text-[var(--color-text-muted)]">
            Contact your admin to connect or manage platform integrations.
          </p>
        </div>
      </div>
    );
  }

  const pausedCount = connections.filter((c) => accountState(connections, c.id, tenantPlan) === "plan_limit").length;

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connect eBay and Amazon to sync orders automatically"
      />
      {pausedCount > 0 && (
        <div className="mb-4 rounded-[var(--radius-btn)] bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning-text)]">
          {pausedCount} account{pausedCount === 1 ? " is" : "s are"} paused by your plan&apos;s account limit. Pause the accounts you don&apos;t need to choose which stay active, or upgrade your plan.
        </div>
      )}
      {needsReconnectBanner(connections) && (
        <div className="mb-4 rounded-[var(--radius-btn)] bg-[var(--color-info-bg)] px-4 py-3 text-sm text-[var(--color-info-text)]">
          Reconnect your eBay account once to enable multiple eBay accounts.
        </div>
      )}
      <div className="space-y-8">
        {PLATFORMS.map((platform) => (
          <PlatformAccountsSection key={platform} platform={platform} connections={connections} plan={tenantPlan} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={null}>
      <IntegrationsContent />
    </Suspense>
  );
}
