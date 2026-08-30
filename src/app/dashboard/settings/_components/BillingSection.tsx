"use client";

import { useEffect, useRef, useState } from "react";
import { PlanPicker } from "@/components/billing/PlanPicker";
import type { PaidPlan } from "@/lib/utils/pricing";
import type { TenantPlan } from "@/types";

interface BillingStatus {
  plan: TenantPlan;
  hasSubscription: boolean;
  cancelAtPeriodEnd: boolean;
  canManageBilling: boolean;
}

const RECONCILE_ATTEMPTS = 3;
const RECONCILE_DELAY_MS = 1500;

async function fetchBillingStatus(): Promise<BillingStatus> {
  const res = await fetch("/api/billing/status");
  const body = (await res.json()) as BillingStatus & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? "Could not load billing status.");
  }
  return body;
}

/**
 * Polls billing status a few times, stopping early once `isDone` returns
 * true. The webhook is the only writer of control.tenants.plan/status
 * (AGENTS.md rule 4), so this can only ever wait for what it eventually
 * confirms, never assume it — used both after a plan change (wait for the
 * new plan to land) and after returning from Stripe checkout (wait for
 * hasSubscription to flip true).
 */
async function pollBillingStatus(
  isDone: (data: BillingStatus) => boolean,
  onUpdate: (data: BillingStatus) => void
): Promise<void> {
  for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, RECONCILE_DELAY_MS));
    try {
      const data = await fetchBillingStatus();
      onUpdate(data);
      if (isDone(data)) return;
    } catch {
      // A transient failure mid-poll shouldn't stop the remaining attempts.
    }
  }
}

export function BillingSection() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<PaidPlan | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCheckout, setConfirmingCheckout] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    fetchBillingStatus()
      .then((data) => {
        if (mountedRef.current) setStatus(data);
      })
      .catch(() => {
        if (mountedRef.current) setError("Could not load billing status.");
      });
  }, []);

  useEffect(() => {
    // Deferred via a microtask rather than called directly: a synchronous
    // setState as the first statement in an effect body trips this repo's
    // react-hooks/set-state-in-effect lint rule — same pattern as
    // src/app/welcome/page.tsx's auto-sync. This MUST be a real effect, not
    // a lazy useState initializer: Stripe's success_url redirect is a full
    // browser navigation, so this component is server-rendered first (no
    // `window`), and hydration does not re-invoke a useState initializer —
    // a lazy initializer here would permanently read `false` for exactly
    // the real-world case this feature exists to handle.
    Promise.resolve().then(() => {
      const isSuccess = new URLSearchParams(window.location.search).get("billing") === "success";
      if (!isSuccess) return;
      setConfirmingCheckout(true);
      void pollBillingStatus(
        (data) => data.hasSubscription,
        (data) => {
          if (mountedRef.current) setStatus(data);
        }
      ).then(() => {
        if (mountedRef.current) setConfirmingCheckout(false);
      });
    });
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
      // change-plan succeeded (no redirect). Optimistic update for immediate
      // feedback, then a bounded reconciliation — a single check could
      // visibly revert a correct update if the webhook hasn't landed yet;
      // polling a few times and stopping once the fetched plan matches
      // avoids that.
      setStatus({ ...status, plan });
      setLoadingPlan(null);
      void pollBillingStatus(
        (data) => data.plan === plan,
        (data) => {
          if (mountedRef.current) setStatus(data);
        }
      );
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
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          {error ?? "Loading…"}
        </p>
      </section>
    );
  }

  const currentPaidPlan = status.plan === "trial" ? undefined : (status.plan as PaidPlan);

  return (
    <section className="max-w-2xl space-y-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <h2 className="text-base font-semibold text-[var(--color-text-strong)]">Billing</h2>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {confirmingCheckout && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Payment received — setting up your subscription…
        </p>
      )}

      {status.hasSubscription && status.cancelAtPeriodEnd && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Your subscription is set to cancel at the end of the current billing period.
        </p>
      )}

      {status.canManageBilling ? (
        <>
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
        </>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">
          {status.hasSubscription
            ? `Your workspace is on the ${currentPaidPlan ?? status.plan} plan. Only an admin can change or cancel it.`
            : "Your workspace is on a trial. Only an admin can subscribe."}
        </p>
      )}
    </section>
  );
}
