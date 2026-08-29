"use client";

import { useState } from "react";
import { PlanPicker } from "@/components/billing/PlanPicker";
import type { PaidPlan } from "@/lib/utils/pricing";

export default function TrialExpiredPage() {
  const [loadingPlan, setLoadingPlan] = useState<PaidPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelectPlan(plan: PaidPlan) {
    setError(null);
    setLoadingPlan(plan);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setError(body.error ?? "Could not start checkout. Please try again.");
        setLoadingPlan(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Network error — please try again.");
      setLoadingPlan(null);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-(--color-bg) px-4 py-12">
      <div className="w-full max-w-4xl text-center">
        <h1 className="text-xl font-bold text-(--color-text-strong) mb-3">
          Your free trial has ended
        </h1>
        <p className="text-sm text-(--color-text-muted)">
          Your 14-day Boughtopia trial is over. All of your data is safe and
          will be exactly as you left it as soon as you choose a plan.
        </p>

        {error && <p className="mt-4 text-sm text-(--color-danger-text)">{error}</p>}

        <div className="mt-8">
          <PlanPicker onSelectPlan={handleSelectPlan} loadingPlan={loadingPlan} />
        </div>
      </div>
    </div>
  );
}
