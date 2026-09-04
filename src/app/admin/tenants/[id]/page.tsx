"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { AiUsageBreakdown } from "../../_components/AiUsageBreakdown";
import { TenantDetailActions } from "../../_components/TenantDetailActions";
import { PLAN_VARIANT, STATUS_VARIANT } from "../../_components/tenantVariants";
import type { Tenant } from "@/types";
import { ArrowLeft, Building2 } from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function TenantDetailPage({ params }: PageProps) {
  const { id } = use(params);

  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [aiUsage, setAiUsage] = useState<Record<string, { used: number; limit: number; byUser: Record<string, number> }>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/tenants")
      .then((r) => r.json())
      .then((data: { tenants?: Tenant[] }) => {
        if (!cancelled) setTenants(data.tenants ?? []);
      })
      .catch(() => { if (!cancelled) setTenants([]); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/ai-usage")
      .then((r) => r.json())
      .then((data: { usage?: { tenantId: string; used: number; limit: number; byUser: Record<string, number> }[] }) => {
        if (cancelled) return;
        const map: Record<string, { used: number; limit: number; byUser: Record<string, number> }> = {};
        for (const row of data.usage ?? []) {
          map[row.tenantId] = { used: row.used, limit: row.limit, byUser: row.byUser };
        }
        setAiUsage(map);
      })
      .catch(() => { if (!cancelled) setAiUsage({}); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const loading = tenants === null;
  const tenant = tenants?.find((t) => t.id === id) ?? null;
  const usage = aiUsage[id];

  const cardCls = "bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-5";

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-(--color-text-muted) hover:text-(--color-text-base) transition-colors mb-6"
      >
        <ArrowLeft size={15} />
        Back to Tenant Management
      </Link>

      {loading ? (
        <p className="text-sm text-(--color-text-muted) py-8 text-center">Loading…</p>
      ) : !tenant ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Building2 size={32} className="text-(--color-text-faint) mb-3" />
          <p className="text-sm text-(--color-text-muted)">Tenant not found.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-(--color-text-strong)">{tenant.name}</h1>
              <p className="text-xs text-(--color-text-faint) font-mono">{tenant.schema_name}</p>
            </div>
            <Badge label={tenant.plan} variant={PLAN_VARIANT[tenant.plan]} />
            <Badge label={tenant.status} variant={STATUS_VARIANT[tenant.status]} />
          </div>

          <div className={cardCls}>
            <h2 className="text-sm font-semibold text-(--color-text-base) mb-4">Details</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-(--color-text-faint) mb-1">Admin Email</dt>
                <dd className="text-(--color-text-strong)">{tenant.admin_email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-(--color-text-faint) mb-1">Trial Ends</dt>
                <dd className="text-(--color-text-strong)">
                  {tenant.trial_ends_at ? new Date(tenant.trial_ends_at).toLocaleDateString("de-DE") : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-(--color-text-faint) mb-1">Created</dt>
                <dd className="text-(--color-text-strong)">
                  {new Date(tenant.created_at).toLocaleDateString("de-DE")}
                </dd>
              </div>
            </dl>
          </div>

          <div className={cardCls}>
            <h2 className="text-sm font-semibold text-(--color-text-base) mb-4">AI Usage</h2>
            {usage && usage.limit > 0 ? (
              <AiUsageBreakdown used={usage.used} limit={usage.limit} byUser={usage.byUser} />
            ) : (
              <p className="text-sm text-(--color-text-faint)">
                AI usage tracking is not available on this plan.
              </p>
            )}
          </div>

          <div className={cardCls}>
            <h2 className="text-sm font-semibold text-(--color-text-base) mb-4">Actions</h2>
            <TenantDetailActions tenant={tenant} onRefresh={() => setRefreshKey((k) => k + 1)} />
          </div>
        </div>
      )}
    </div>
  );
}
