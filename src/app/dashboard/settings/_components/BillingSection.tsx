"use client";

import { useEffect, useState } from "react";
import { PlanPicker } from "@/components/billing/PlanPicker";
import type { PaidPlan } from "@/lib/utils/pricing";
import type { TenantPlan } from "@/types";

interface BillingStatus {
  plan: TenantPlan;
  hasSubscription: boolean;
  cancelAtPeriodEnd: boolean;
}

export function BillingSection() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<PaidPlan | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/status")
      .then((res) => res.json())
      .then((data: BillingStatus) => setStatus(data))
      .catch(() => setError("Could not load billing status."));
  }, []);

  async function handleSelectPlan(plan: PaidPlan) {
    if (!status) return;
    setError(null);
    setLoadingPlan(plan);
    const endpoint = status.hasSubscription ? "/api/billing/change-plan" : "/api/billing/checkout";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = (await res.json()) as { url?: string; ok?: boolean; error?: string };
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.");
        setLoadingPlan(null);
        return;
      }
      if (body.url) {
        window.location.href = body.url;
        return;
      }
      // change-plan succeeded (no redirect) — reflect the new plan locally.
      setStatus({ ...status, plan });
      setLoadingPlan(null);
    } catch {
      setError("Network error — please try again.");
      setLoadingPlan(null);
    }
  }

  async function handleCancel() {
    setError(null);
    setCanceling(true);
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not cancel subscription.");
        setCanceling(false);
        return;
      }
      setStatus((prev) => (prev ? { ...prev, cancelAtPeriodEnd: true } : prev));
      setCanceling(false);
    } catch {
      setError("Network error — please try again.");
      setCanceling(false);
    }
  }

  if (!status) {
    return (
      <section className="max-w-2xl rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="text-base font-semibold text-[var(--color-text-strong)]">Billing</h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">Loading…</p>
      </section>
    );
  }

  const currentPaidPlan = status.plan === "trial" ? undefined : (status.plan as PaidPlan);

  return (
    <section className="max-w-2xl space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <h2 className="text-base font-semibold text-[var(--color-text-strong)]">Billing</h2>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {status.hasSubscription && status.cancelAtPeriodEnd && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Your subscription is set to cancel at the end of the current billing period.
        </p>
      )}

      <PlanPicker
        onSelectPlan={handleSelectPlan}
        currentPlan={status.hasSubscription ? currentPaidPlan : undefined}
        loadingPlan={loadingPlan}
      />

      {status.hasSubscription && !status.cancelAtPeriodEnd && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={canceling}
          className="text-sm font-medium text-[var(--color-danger-text)] hover:underline disabled:opacity-60"
        >
          {canceling ? "Cancelling…" : "Cancel subscription"}
        </button>
      )}
    </section>
  );
}
