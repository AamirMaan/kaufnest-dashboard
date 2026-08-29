import Link from "next/link";

export function Hero() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-20 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-(--color-text-strong) sm:text-5xl">
        Bookkeeping for multi-platform sellers
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-lg text-(--color-text-muted)">
        Track every sale, expense and unit of stock across eBay, Amazon, Etsy and
        Shopify — with VAT, invoices and a full audit trail in one place.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          href="/signup"
          className="rounded-(--radius-btn) bg-(--color-primary) px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-(--color-primary-hover)"
        >
          Start your free trial
        </Link>
        <Link
          href="#pricing"
          className="rounded-(--radius-btn) border border-(--color-border) px-6 py-3 text-sm font-semibold text-(--color-text-base) transition-colors hover:text-(--color-text-strong)"
        >
          See pricing
        </Link>
      </div>
      <p className="mt-4 text-sm text-(--color-text-muted)">
        14 days free · full access · no credit card
      </p>
    </section>
  );
}
