import Link from "next/link";
import { Check, X } from "lucide-react";
import { pricedPlans } from "../_lib/pricing";

export function Pricing() {
  const plans = pricedPlans();

  return (
    <section id="pricing" className="border-t border-(--color-border)">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-(--color-text-strong)">
          Simple monthly pricing
        </h2>
        <p className="mt-3 text-center text-sm text-(--color-text-muted)">
          Every plan starts with the same 14-day free trial.
        </p>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.plan}
              className={`rounded-(--radius-card) border bg-(--color-surface) p-6 ${
                plan.highlighted
                  ? "border-emerald-500 shadow-xl shadow-emerald-500/10"
                  : "border-(--color-border)"
              }`}
            >
              {plan.highlighted && (
                <span className="mb-3 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                  Most popular
                </span>
              )}
              <h3 className="text-base font-bold text-(--color-text-strong)">{plan.name}</h3>
              <p className="mt-1 text-sm text-(--color-text-muted)">{plan.tagline}</p>

              <p className="mt-5">
                <span className="text-3xl font-bold text-(--color-text-strong)">
                  €{plan.monthlyEur}
                </span>
                <span className="text-sm text-(--color-text-muted)"> / month</span>
              </p>
              <p className="mt-1 text-sm font-medium text-(--color-text-base)">{plan.users}</p>

              <Link
                href="/signup"
                className={`mt-6 block rounded-(--radius-btn) px-4 py-2 text-center text-sm font-semibold transition-colors ${
                  plan.highlighted
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "border border-(--color-border) text-(--color-text-base) hover:text-(--color-text-strong)"
                }`}
              >
                Start free trial
              </Link>

              <ul className="mt-6 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature.label} className="flex items-start gap-2 text-sm">
                    {feature.included ? (
                      <Check size={16} className="mt-0.5 shrink-0 text-(--color-success)" aria-hidden="true" />
                    ) : (
                      <X size={16} className="mt-0.5 shrink-0 text-(--color-text-faint)" aria-hidden="true" />
                    )}
                    <span
                      className={
                        feature.included ? "text-(--color-text-base)" : "text-(--color-text-faint)"
                      }
                    >
                      {feature.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
