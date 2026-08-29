const LOGOS = [
  { src: "/brand/e-bay-logo.svg", alt: "eBay", className: "h-7" },
  { src: "/brand/amazon-logo.svg", alt: "Amazon", className: "h-8" },
  { src: "/brand/etsy.svg", alt: "Etsy", className: "h-7" },
  { src: "/brand/shopify-logo2.svg", alt: "Shopify", className: "h-7" },
];

export function IntegrationsBar() {
  return (
    <section className="border-t border-(--color-border) bg-white py-10">
      <div className="mx-auto max-w-5xl px-6">
        <p className="text-center text-sm font-semibold uppercase tracking-wide text-(--color-text-faint)">
          Sync with the platforms you already sell on
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
          {LOGOS.map((logo) => (
            <img
              key={logo.alt}
              src={logo.src}
              alt={logo.alt}
              className={`${logo.className} w-auto grayscale opacity-60 transition hover:opacity-100 hover:grayscale-0`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
