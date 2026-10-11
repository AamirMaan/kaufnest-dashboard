"use client";

import type { PricedPlan } from "@/lib/utils/pricing";

interface PlanPickerProps {
  /** The plans this tenant may buy — `plans` from /api/billing/status
   * (built server-side from control.plans). */
  plans: PricedPlan[];
  /** Called with the plan the visitor picked. The caller decides whether
   * that means starting a fresh checkout or changing an existing
   * subscription — this component doesn't know which. */
  onSelectPlan: (plan: string) => void;
  /** The tenant's current plan, if they already have one. Rendered as a
   * disabled "Current plan" card instead of a button. */
  currentPlan?: string;
  /** The plan currently mid-request, if any — disables its button and
   * shows a loading label instead of "Subscribe"/"Switch to X". */
  loadingPlan?: string | null;
}

export function PlanPicker({ plans, onSelectPlan, currentPlan, loadingPlan }: PlanPickerProps) {
  if (plans.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">No plans are available right now. Please try again later.</p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {plans.map((plan) => {
        const isCurrent = plan.plan === currentPlan;
        return (
          <div
            key={plan.plan}
            className={`rounded-[var(--radius-card)] border p-6 ${
              isCurrent ? "border-[var(--color-primary)]" : "border-[var(--color-border)]"
            } bg-[var(--color-surface)]`}
          >
            <h3 className="text-lg font-bold text-[var(--color-text-strong)]">{plan.name}</h3>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{plan.tagline}</p>
            <p className="mt-4">
              <span className="text-3xl font-bold text-[var(--color-text-strong)]">
                €{plan.monthlyEur}
              </span>
              <span className="text-sm text-[var(--color-text-muted)]"> / month</span>
            </p>
            <p className="mt-1 text-sm font-medium text-[var(--color-text-base)]">{plan.users}</p>

            {isCurrent ? (
              <p className="mt-6 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-4 py-2 text-center text-sm font-semibold text-[var(--color-text-muted)]">
                Current plan
              </p>
            ) : (
              <button
                type="button"
                onClick={() => onSelectPlan(plan.plan)}
                disabled={loadingPlan === plan.plan}
                className="mt-6 w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loadingPlan === plan.plan
                  ? "Redirecting…"
                  : currentPlan
                    ? `Switch to ${plan.name}`
                    : "Subscribe"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
