import Link from "next/link";

export function MarketingNav() {
  return (
    <header className="border-b border-(--color-border)">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <span className="flex items-center gap-2">
          <img src="/brand/boughtopia-icon-bag.svg" alt="" aria-hidden="true" width={26} height={26} />
          <span className="text-lg font-bold tracking-tight text-(--color-text-strong)">
            Bought<span className="text-(--color-primary)">opia</span>
          </span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm font-medium text-(--color-text-base) hover:text-(--color-text-strong)">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-(--radius-btn) bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            Start free trial
          </Link>
        </div>
      </nav>
    </header>
  );
}
