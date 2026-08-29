export function IntegrationsBar() {
  return (
    <section className="border-t border-(--color-border) bg-white py-10">
      <div className="mx-auto max-w-5xl px-6">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-(--color-text-faint)">
          Sync with the platforms you already sell on
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
          <img
            src="/brand/e-bay-logo.svg"
            alt="eBay"
            className="h-6 w-auto grayscale opacity-60 transition hover:opacity-100 hover:grayscale-0"
          />
          <img
            src="/brand/amazon-logo.svg"
            alt="Amazon"
            className="h-7 w-auto grayscale opacity-60 transition hover:opacity-100 hover:grayscale-0"
          />
          <span className="text-xl font-bold text-(--color-text-faint)">Etsy</span>
          <span className="text-xl font-bold text-(--color-text-faint)">Shopify</span>
        </div>
      </div>
    </section>
  );
}
