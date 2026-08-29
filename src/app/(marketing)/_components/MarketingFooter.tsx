import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="border-t border-(--color-border)">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-(--color-text-muted) sm:flex-row">
        <span>&copy; {new Date().getFullYear()} Boughtopia</span>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="hover:text-(--color-text-strong)">
            Privacy
          </Link>
          <Link href="/login" className="hover:text-(--color-text-strong)">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
