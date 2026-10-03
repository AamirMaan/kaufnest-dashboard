"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronLeft, Layers } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PlanForm } from "../_components/PlanForm";
import { PlanCatalogStatus } from "../_components/PlanCatalogStatus";
import { usePlanCatalog } from "../_components/usePlanCatalog";
import { visibilityBadge } from "../_lib/planFormState";

interface PageProps {
  params: Promise<{ key: string }>;
}

export default function EditPlanPage({ params }: PageProps) {
  const { key } = use(params);
  const { plans, tenantCounts, error, version, reload } = usePlanCatalog();
  const plan = plans?.find((p) => p.key === key) ?? null;
  const badge = plan ? visibilityBadge(plan) : null;

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/admin/plans"
        className="inline-flex items-center gap-1.5 text-sm text-(--color-text-muted) hover:text-(--color-text-base) transition-colors mb-6"
      >
        <ChevronLeft size={15} />
        Plans
      </Link>

      {plans === null ? (
        <PlanCatalogStatus error={error} onRetry={reload} />
      ) : !plan || !badge ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Layers size={32} className="text-(--color-text-faint) mb-3" />
          <p className="text-sm text-(--color-text-muted)">Plan not found</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <h1 className="text-2xl font-bold text-(--color-text-strong)">{plan.name}</h1>
            <Badge label={badge.label} variant={badge.variant} />
          </div>
          {/* Keyed on the catalog version: after a save, reload() refetches and
              the form remounts with the saved plan as its new baseline. */}
          <PlanForm
            key={`${plan.key}-${version}`}
            mode="edit"
            original={plan}
            catalog={plans}
            tenantCount={tenantCounts[key] ?? 0}
            onSaved={reload}
          />
        </>
      )}
    </div>
  );
}
