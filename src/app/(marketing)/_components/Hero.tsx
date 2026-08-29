import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-emerald-50 via-white to-white" />
      <div
        aria-hidden="true"
        className="absolute -left-24 top-10 -z-10 h-72 w-72 rounded-full bg-emerald-200/40 blur-3xl animate-pulse"
      />
      <div
        aria-hidden="true"
        className="absolute -right-24 top-40 -z-10 h-72 w-72 rounded-full bg-amber-200/40 blur-3xl animate-pulse [animation-delay:1s]"
      />

      <div className="mx-auto max-w-3xl px-6 pt-24 pb-16 text-center">
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-3.5 py-1.5 text-sm font-semibold text-emerald-700">
          14 days free · full access · no credit card
        </span>
        <h1 className="mt-6 text-5xl font-bold tracking-tight text-(--color-text-strong) sm:text-7xl">
          Bookkeeping for <span className="text-emerald-600">multi-platform sellers</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-xl text-(--color-text-muted)">
          Track every sale, expense and unit of stock across eBay, Amazon, Etsy and
          Shopify — with VAT, invoices and a full audit trail in one place.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-(--radius-btn) bg-emerald-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-emerald-600/20 transition-colors hover:bg-emerald-700"
          >
            Start your free trial
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
          {/* Plain <a>, not next/link's <Link>: this is a same-page hash
              link, and Link only re-scrolls on an actual URL change — a
              second click when the hash is already #pricing (e.g. after
              scrolling away and back) silently does nothing. A native
              anchor always re-triggers the browser's scroll-to-anchor. */}
          <a
            href="#pricing"
            className="text-base font-semibold text-(--color-text-base) transition-colors hover:text-(--color-text-strong)"
          >
            See pricing
          </a>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 pb-24">
        <div className="overflow-hidden rounded-2xl border border-(--color-border) shadow-2xl shadow-emerald-900/10">
          <img
            src="/brand/Boughtopia-dashboard.png"
            alt="Boughtopia dashboard showing revenue, expenses, and eBay balance overview"
            className="w-full"
          />
        </div>
      </div>
    </section>
  );
}
