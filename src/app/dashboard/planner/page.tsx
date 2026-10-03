"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { hasPlatformIntegrations } from "@/lib/plans/entitlements";
import { usePlan } from "@/store/usePlan";
import { EbayPlanner } from "./_components/EbayPlanner";
import { AmazonPlanner } from "./_components/AmazonPlanner";

type PlatformTab = "ebay" | "amazon";

const TABS: { key: PlatformTab; label: string }[] = [
  { key: "ebay", label: "eBay" },
  { key: "amazon", label: "Amazon" },
];

export default function PlannerPage() {
  const { ent, availability } = usePlan();
  const [activeTab, setActiveTab] = useState<PlatformTab>("ebay");

  if (!ent || !hasPlatformIntegrations(ent)) {
    return (
      <div>
        <PageHeader
          title="Profit Planner"
          description="Calculate profit and minimum selling price for eBay and Amazon"
        />
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h2 className="text-sm font-semibold text-[var(--color-text-strong)]">
            Upgrade to unlock the Planner
          </h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            {availability("platformIntegrations", "The Profit Planner")}
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

  return (
    <div>
      <PageHeader
        title="Profit Planner"
        description="Calculate profit and minimum selling price for eBay and Amazon"
      />

      <div className="flex gap-1 mb-6 border-b border-[var(--color-border)]">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={[
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer",
              activeTab === key
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "ebay" ? <EbayPlanner /> : <AmazonPlanner />}
    </div>
  );
}
