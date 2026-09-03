"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { TenantActions } from "./_components/TenantActions";
import { AddTenantModal } from "./_components/AddTenantModal";
import { AiUsageModal } from "./_components/AiUsageModal";
import type { Tenant } from "@/types";
import { Plus, Building2 } from "lucide-react";
import { PLAN_VARIANT, STATUS_VARIANT } from "./_components/tenantVariants";

export default function AdminPage() {
  // null = not yet loaded (shows skeleton), array = loaded
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [aiUsage, setAiUsage] = useState<Record<string, { used: number; limit: number; byUser: Record<string, number> }>>({});
  const [usageTenant, setUsageTenant] = useState<Tenant | null>(null);

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

  const list      = tenants ?? [];
  const total     = list.length;
  const active      = list.filter((t) => t.status === "active").length;
  const invited     = list.filter((t) => t.status === "invited").length;
  const deactivated = list.filter((t) => t.status === "deactivated").length;

  const cardCls = "bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-5";

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-(--color-text-strong)">Tenant Management</h1>
          <p className="text-sm text-(--color-text-muted) mt-1">Provision and manage Boughtopia tenants</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={15} />
          Add Tenant
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total Tenants", value: total },
          { label: "Active",        value: active },
          { label: "Invited",       value: invited },
          { label: "Deactivated",   value: deactivated },
        ].map(({ label, value }) => (
          <div key={label} className={cardCls}>
            <p className="text-xs font-medium uppercase tracking-wider text-(--color-text-faint) mb-1">
              {label}
            </p>
            <p className="text-2xl font-bold text-(--color-text-strong)">{value}</p>
          </div>
        ))}
      </div>

      {/* Tenants table */}
      <div className={cardCls}>
        <h2 className="text-sm font-semibold text-(--color-text-base) mb-4">All Tenants</h2>

        {loading ? (
          <p className="text-sm text-(--color-text-muted) py-8 text-center">Loading…</p>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <Building2 size={32} className="text-(--color-text-faint) mb-3" />
            <p className="text-sm text-(--color-text-muted)">No tenants yet. Create the first one.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--color-border)">
                  {["Tenant", "Admin Email", "Plan", "Status", "AI Usage", "Trial Ends", "Created", "Actions"].map((h) => (
                    <th
                      key={h}
                      className="text-left text-xs font-semibold uppercase tracking-wider text-(--color-text-faint) pb-3 pr-4"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-border)">
                {list.map((t) => (
                  <tr key={t.id} className="hover:bg-(--color-surface-subtle) transition-colors">
                    <td className="py-3 pr-4">
                      <p className="font-medium text-(--color-text-strong)">{t.name}</p>
                      <p className="text-xs text-(--color-text-faint) font-mono">{t.schema_name}</p>
                    </td>
                    <td className="py-3 pr-4 text-(--color-text-muted)">
                      {t.admin_email ?? "—"}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge label={t.plan} variant={PLAN_VARIANT[t.plan]} />
                    </td>
                    <td className="py-3 pr-4">
                      <Badge label={t.status} variant={STATUS_VARIANT[t.status]} />
                    </td>
                    <td className="py-3 pr-4">
                      {aiUsage[t.id] && aiUsage[t.id].limit > 0 ? (
                        <button
                          type="button"
                          onClick={() => setUsageTenant(t)}
                          className="text-(--color-primary) hover:underline"
                        >
                          {aiUsage[t.id].used} / {aiUsage[t.id].limit}
                        </button>
                      ) : (
                        <span className="text-(--color-text-faint)">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-(--color-text-muted)">
                      {t.trial_ends_at
                        ? new Date(t.trial_ends_at).toLocaleDateString("de-DE")
                        : "—"}
                    </td>
                    <td className="py-3 pr-4 text-(--color-text-muted)">
                      {new Date(t.created_at).toLocaleDateString("de-DE")}
                    </td>
                    <td className="py-3">
                      <TenantActions tenant={t} onRefresh={() => setRefreshKey((k) => k + 1)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddTenantModal
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setRefreshKey((k) => k + 1);
        }}
      />

      {usageTenant && (
        <AiUsageModal
          open={!!usageTenant}
          tenant={usageTenant}
          used={aiUsage[usageTenant.id]?.used ?? 0}
          limit={aiUsage[usageTenant.id]?.limit ?? 0}
          byUser={aiUsage[usageTenant.id]?.byUser ?? {}}
          onClose={() => setUsageTenant(null)}
        />
      )}
    </div>
  );
}
