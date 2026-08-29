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
 * confirms, never assume it — mirrors BillingSection.tsx's
 * `pollBillingStatus`, used here to wait for `hasSubscription` after
 * returning from Stripe checkout.
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

export default function TrialExpiredPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<PaidPlan | null>(null);
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
        // A failed status read shouldn't block the page — it just means we
        // can't gate PlanPicker or detect an already-active subscription;
        // the safe default (render PlanPicker) still applies.
      });
  }, []);

  useEffect(() => {
    // Deferred via a microtask rather than called directly: a synchronous
    // setState as the first statement in an effect body trips this repo's
    // react-hooks/set-state-in-effect lint rule — same pattern as
    // BillingSection.tsx's checkout-success handling. This MUST be a real
    // effect, not a lazy useState initializer: Stripe's success_url redirect
    // (relayed here via proxy.ts's redirect back to /trial-expired while the
    // webhook is still landing) is a full browser navigation, so this
    // component is server-rendered first (no `window`), and hydration does
    // not re-invoke a useState initializer.
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
        if (!mountedRef.current) return;
        setConfirmingCheckout(false);
      });
    });
  }, []);

  useEffect(() => {
    // Covers two cases with one check: (1) the page loaded and the tenant
    // already has an active subscription (e.g. the webhook caught up since
    // a previous visit), and (2) the post-checkout poll above just fetched
    // a status with hasSubscription true. Either way, there's nothing left
    // to do on this page. This is a full browser navigation (not a
    // setState), so there's no cascading-render concern and nothing to
    // guard against calling more than once — the navigation itself unmounts
    // the page.
    if (status?.hasSubscription) {
      window.location.href = "/dashboard";
    }
  }, [status]);

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

        {confirmingCheckout && (
          <p className="mt-4 text-sm text-(--color-text-muted)">
            Payment received — setting up your subscription…
          </p>
        )}

        {error && <p className="mt-4 text-sm text-(--color-danger-text)">{error}</p>}

        {!confirmingCheckout &&
          (status && !status.canManageBilling ? (
            <p className="mt-8 text-sm text-(--color-text-muted)">
              Your workspace is on a trial that has ended. Only an admin can
              choose a plan.
            </p>
          ) : (
            <div className="mt-8">
              <PlanPicker onSelectPlan={handleSelectPlan} loadingPlan={loadingPlan} />
            </div>
          ))}
      </div>
    </div>
  );
}
