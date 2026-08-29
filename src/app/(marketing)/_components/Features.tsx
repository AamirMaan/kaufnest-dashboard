import { Layers, RefreshCw, Receipt, Package, MessageSquare, Users, type LucideIcon } from "lucide-react";

const FEATURES: { title: string; body: string; icon: LucideIcon }[] = [
  {
    title: "Every platform, one ledger",
    body: "Sales, expenses and purchases across eBay, Amazon, Etsy and Shopify — with per-platform balances and payout tracking.",
    icon: Layers,
  },
  {
    title: "Orders pulled in automatically",
    body: "Connect your eBay and Amazon seller accounts and review orders before importing them. No copy-paste.",
    icon: RefreshCw,
  },
  {
    title: "VAT and invoices, handled",
    body: "VAT positions calculated as you go, and branded PDF invoices generated straight from your records.",
    icon: Receipt,
  },
  {
    title: "Inventory that stays honest",
    body: "Stock levels move themselves as sales and purchases land, with low-stock alerts before you run out.",
    icon: Package,
  },
  {
    title: "Sell and reply without leaving",
    body: "Create eBay listings and answer buyer messages from the same dashboard as your books.",
    icon: MessageSquare,
  },
  {
    title: "Built for a team",
    body: "Roles, per-user permissions and a complete audit trail of who changed what, and when.",
    icon: Users,
  },
];

export function Features() {
  return (
    <section className="border-t border-(--color-border) bg-(--color-surface)">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-(--color-text-strong)">
          Everything the books need
        </h2>
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title}>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                <feature.icon size={20} className="text-emerald-600" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-(--color-text-strong)">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-(--color-text-muted)">{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
