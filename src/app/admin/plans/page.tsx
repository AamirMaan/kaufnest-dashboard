"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { sortPlans, type PlanFeature } from "@/lib/plans/entitlements";
import { Check, Layers, Menu, Plus, X } from "lucide-react";
import { visibilityBadge } from "./_lib/planFormState";
import { usePlanCatalog } from "./_components/usePlanCatalog";
import { PlanCatalogStatus } from "./_components/PlanCatalogStatus";

const FEATURE_COLUMNS: { field: PlanFeature; label: string }[] = [
  { field: "platformIntegrations", label: "Platform integrations" },
  { field: "aiFeatures", label: "AI features" },
  { field: "messagingAndListings", label: "Listings & messages" },
  { field: "advancedInventory", label: "Advanced inventory" },
];

export default function AdminPlansPage() {
  const router = useRouter();
  const { plans, tenantCounts, error, reload } = usePlanCatalog();

  const cardCls = "bg-(--color-surface) rounded-[var(--radius-card)] border border-(--color-border) p-5";

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-(--color-text-strong)">Plans</h1>
          <p className="text-sm text-(--color-text-muted) mt-1">
            Prices, limits and features for every subscription plan.
          </p>
        </div>
        <Button onClick={() => router.push("/admin/plans/new")}>
          <Plus size={15} />
          New plan
        </Button>
      </div>

      <div className={cardCls}>
        {plans === null ? (
          <PlanCatalogStatus error={error} onRetry={reload} />
        ) : plans.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <Layers size={32} className="text-(--color-text-faint) mb-3" />
            <p className="text-sm text-(--color-text-muted)">No plans yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--color-border)">
                  {["Plan", "Visibility", "Price", "Users", "Features", "Tenants", ""].map((h) => (
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
                {sortPlans(plans).map((p) => {
                  const badge = visibilityBadge(p);
                  return (
                    <tr key={p.key} className="hover:bg-(--color-surface-subtle) transition-colors">
                      <td className="py-3 pr-4">
                        <p className="font-medium text-(--color-text-strong)">{p.name}</p>
                        <p className="text-xs text-(--color-text-faint) font-mono">{p.key}</p>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge label={badge.label} variant={badge.variant} />
                      </td>
                      <td className="py-3 pr-4 text-(--color-text-base)">
                        {p.monthlyEur !== null ? `€${p.monthlyEur}/mo` : "—"}
                      </td>
                      <td className="py-3 pr-4 text-(--color-text-base)">
                        {p.maxUsers === null ? "Unlimited" : p.maxUsers}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-1.5">
                          {FEATURE_COLUMNS.map(({ field, label }) => {
                            const on = p[field];
                            const text = `${label}: ${on ? "included" : "not included"}`;
                            return on ? (
                              <Check key={field} size={14} className="text-(--color-success)" role="img" aria-label={text}>
                                <title>{text}</title>
                              </Check>
                            ) : (
                              <X key={field} size={14} className="text-(--color-text-faint)" role="img" aria-label={text}>
                                <title>{text}</title>
                              </X>
                            );
                          })}
                          {p.aiFeatures && (
                            <span className="ml-1 text-xs text-(--color-text-muted)">
                              AI {p.aiGenerationsPerMonth}/mo
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-(--color-text-base)">{tenantCounts[p.key] ?? 0}</td>
                      <td className="py-3">
                        <Link
                          href={`/admin/plans/${p.key}`}
                          aria-label={`Edit ${p.name}`}
                          className="inline-flex items-center justify-center rounded-(--radius-btn) p-1.5 text-(--color-text-muted) hover:text-(--color-text-base) hover:bg-(--color-surface-subtle) transition-colors"
                        >
                          <Menu size={16} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
