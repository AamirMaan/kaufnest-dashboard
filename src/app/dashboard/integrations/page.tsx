"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { useAppSelector } from "@/store/hooks";
import { useAccess } from "@/store/useAccess";
import { hasPlatformIntegrations } from "@/lib/plans/entitlements";
import { usePlan } from "@/store/usePlan";
import { ConnectionCard } from "./_components/ConnectionCard";
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
  const { ent, availability } = usePlan();
  const connections = useAppSelector((s) => s.integrations.connections);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const err = searchParams.get("error");

    if (connected && (connected === "ebay" || connected === "amazon")) {
      success(`${PLATFORM_LABELS[connected]} connected`, "You can now sync orders from this platform.");
      // Re-fetch server data so the connection card reflects the new status
      router.refresh();
    } else if (err) {
      toastError("Connection failed", err);
    }
  }, [searchParams, success, toastError, router]);

  const canManage = can("integrations", 2);

  if (!ent || !hasPlatformIntegrations(ent)) {
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
            {availability("platformIntegrations", "Automatic eBay and Amazon order syncing")}
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

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connect eBay and Amazon to sync orders automatically"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {PLATFORMS.map((platform) => (
          <ConnectionCard
            key={platform}
            platform={platform}
            connection={connections.find((c) => c.platform === platform)}
            canManage={canManage}
          />
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
