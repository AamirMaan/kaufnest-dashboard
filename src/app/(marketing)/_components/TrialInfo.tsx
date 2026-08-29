import Link from "next/link";

export function TrialInfo() {
  return (
    <section className="border-t border-(--color-border) bg-(--color-surface)">
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h2 className="text-3xl font-bold text-(--color-text-strong)">
          Try the whole thing for 14 days
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-(--color-text-muted)">
          Your trial is not a stripped-down version. You get every feature — including
          the eBay and Amazon integrations, listings and buyer messages — for the full
          fourteen days. No credit card, and nothing to cancel if you decide against it.
        </p>
        <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-(--color-text-muted)">
          When the trial ends your data stays exactly where it is, waiting for you to
          pick a plan.
        </p>
        <Link
          href="/signup"
          className="mt-8 inline-block rounded-(--radius-btn) bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-colors hover:bg-emerald-700"
        >
          Start your free trial
        </Link>
      </div>
    </section>
  );
}
