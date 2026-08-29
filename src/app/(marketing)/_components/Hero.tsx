import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-emerald-50 via-white to-white" />
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
          14 days free · full access · no credit card
        </span>
        <h1 className="mt-6 text-4xl font-bold tracking-tight text-(--color-text-strong) sm:text-6xl">
          Bookkeeping for <span className="text-emerald-600">multi-platform sellers</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-(--color-text-muted)">
          Track every sale, expense and unit of stock across eBay, Amazon, Etsy and
          Shopify — with VAT, invoices and a full audit trail in one place.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-(--radius-btn) bg-emerald-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-colors hover:bg-emerald-700"
          >
            Start your free trial
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link
            href="#pricing"
            className="text-sm font-semibold text-(--color-text-base) transition-colors hover:text-(--color-text-strong)"
          >
            See pricing
          </Link>
        </div>
      </div>
    </section>
  );
}
