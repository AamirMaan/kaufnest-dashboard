"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PlanForm } from "../_components/PlanForm";
import { PlanCatalogStatus } from "../_components/PlanCatalogStatus";
import { usePlanCatalog } from "../_components/usePlanCatalog";

export default function NewPlanPage() {
  const router = useRouter();
  const { plans, error, reload } = usePlanCatalog();

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/admin/plans"
        className="inline-flex items-center gap-1.5 text-sm text-(--color-text-muted) hover:text-(--color-text-base) transition-colors mb-6"
      >
        <ChevronLeft size={15} />
        Plans
      </Link>

      <h1 className="text-2xl font-bold text-(--color-text-strong) mb-6">New plan</h1>

      {plans === null ? (
        <PlanCatalogStatus error={error} onRetry={reload} />
      ) : (
        <PlanForm
          mode="create"
          original={null}
          catalog={plans}
          tenantCount={0}
          onSaved={(p) => router.push(`/admin/plans/${p.key}`)}
        />
      )}
    </div>
  );
}
