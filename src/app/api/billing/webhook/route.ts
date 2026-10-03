import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createControlClient } from "@/lib/supabase/control";
import { getPlanCatalog, getPlanPriceMap, invalidatePlanCatalog } from "@/lib/plans/catalog";
import { resolvePlanKey } from "@/lib/plans/resolvePlanKey";
import type Stripe from "stripe";

// Disable body parsing — Stripe needs the raw body to verify the signature
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const control = createControlClient();
  let writeFailed = false;

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      // Which catalog plan this subscription is on: metadata.plan first
      // (checkout/change-plan always write it), then the price id via
      // control.plan_prices (grandfathered prices, subscriptions edited in
      // the Stripe dashboard). Unknown → leave tenants.plan untouched rather
      // than guessing; the status/subscription-id update still applies —
      // EXCEPT for an active subscription (see below).
      let plan: string | null;
      try {
        // Drop this instance's 60 s catalog cache first: a plan created on
        // another instance seconds ago and bought immediately must resolve
        // here, not fall through as "unknown" on a stale cache.
        invalidatePlanCatalog();
        const [catalog, priceToPlan] = await Promise.all([getPlanCatalog(), getPlanPriceMap()]);
        plan = resolvePlanKey({
          metadataPlan: sub.metadata?.plan,
          priceId: sub.items?.data?.[0]?.price?.id,
          paidPlanKeys: new Set(catalog.filter((p) => p.kind === "paid").map((p) => p.key)),
          priceToPlan,
        });
      } catch (err) {
        // Catalog unreadable: fail the event so Stripe retries it later.
        console.error("[billing/webhook] plan catalog unavailable", err);
        writeFailed = true;
        break;
      }
      if (!plan) {
        console.error("[billing/webhook] unknown plan for subscription", sub.id, sub.items?.data?.[0]?.price?.id);
        // An ACTIVE (i.e. paying) subscription we can't map must not be
        // acknowledged: patching only status would leave a trial tenant on
        // plan 'trial' (later locked out by isTrialExpired) and a 200 means
        // Stripe never retries. Fail the event so it is retried once the
        // catalog / plan_prices catches up.
        if (sub.status === "active") {
          writeFailed = true;
          break;
        }
      }

      const patch: { stripe_subscription_id: string; plan?: string; status?: string } = {
        stripe_subscription_id: sub.id,
        ...(plan ? { plan } : {}),
      };

      // Only touch status for unambiguous outcomes. "incomplete" (payment
      // still processing) and "trialing" (this app never sets
      // trial_period_days on a subscription — Boughtopia's own free trial
      // is unrelated to Stripe's "trialing" status — so this shouldn't
      // occur, but the mapping stays defensive rather than assuming) are
      // deliberately left alone rather than prematurely deactivating a
      // tenant that wasn't deactivated a moment ago.
      if (sub.status === "active") {
        patch.status = "active";
      } else if (
        sub.status === "past_due" ||
        sub.status === "unpaid" ||
        sub.status === "canceled" ||
        sub.status === "incomplete_expired" ||
        sub.status === "paused"
      ) {
        patch.status = "deactivated";
      }

      let query = control
        .schema("control")
        .from("tenants")
        .update(patch)
        .eq("stripe_customer_id", sub.customer as string);

      // A DEACTIVATING update is only allowed to apply if this subscription
      // is still the one on file — same reordering guard as the deleted
      // case below, same reason: a delayed/retried event for an OLD,
      // superseded subscription must never deactivate a tenant who has
      // since moved to a new, active subscription. Deliberately NOT applied
      // when patch.status is "active" (or left unset) — a promoting update
      // must always be allowed to take over stripe_subscription_id, since
      // that's exactly what a legitimate resubscribe's created event does.
      if (patch.status === "deactivated") {
        query = query.eq("stripe_subscription_id", sub.id);
      }

      const failed = await logIfUnmatched(query.select("id"), sub.customer as string, "created/updated");
      if (failed) writeFailed = true;
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const failed = await logIfUnmatched(
        control
          .schema("control")
          .from("tenants")
          .update({ status: "deactivated" })
          .eq("stripe_customer_id", sub.customer as string)
          // Guard against a late/reordered deletion event for an OLD
          // subscription incorrectly deactivating a tenant who has since
          // resubscribed (a newer subscription's created/updated event
          // already overwrote stripe_subscription_id). Stripe does not
          // guarantee webhook delivery order, and this app explicitly
          // supports cancel-then-resubscribe, so this is a real, expected
          // race — not a hypothetical one.
          .eq("stripe_subscription_id", sub.id)
          .select("id"),
        sub.customer as string,
        "deleted"
      );
      if (failed) writeFailed = true;
      break;
    }
  }

  // A genuine DB write failure is retry-worthy — both writes above are
  // idempotent, so letting Stripe retry is safe and is what actually fixes
  // a transient failure instead of silently losing the event. A
  // stripe_customer_id with no matching tenant row (or a benign stale event
  // correctly skipped by the guards above) is NOT a transient failure and
  // stays 200 — see logIfUnmatched.
  if (writeFailed) {
    return NextResponse.json({ error: "Failed to process event" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/**
 * Awaits the query and logs the outcome. Returns `true` only for a genuine
 * database error (caller should surface this to Stripe as retry-worthy);
 * a zero-row match is logged but returns `false`, since it covers two
 * benign cases — a stripe_customer_id with no tenant row, or (for the
 * deactivating branches above) a stale/reordered event correctly skipped
 * because a newer subscription has since superseded it.
 */
async function logIfUnmatched(
  query: PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>,
  stripeCustomerId: string,
  eventLabel: string
): Promise<boolean> {
  const { data, error } = await query;
  if (error) {
    console.error(`[billing/webhook] ${eventLabel} update failed:`, error.message);
    return true;
  }
  if (!data || data.length === 0) {
    console.error(
      `[billing/webhook] ${eventLabel}: no tenant row matched stripe_customer_id=${stripeCustomerId} — ` +
        "either no tenant exists for this customer, or (for a deactivating event) a newer " +
        "subscription has already superseded this one, which is benign."
    );
  }
  return false;
}
