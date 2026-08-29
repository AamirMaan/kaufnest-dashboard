import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="border-t border-(--color-border)">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-(--color-text-muted) sm:flex-row">
        <span>&copy; {new Date().getFullYear()} Boughtopia</span>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="hover:text-emerald-600">
            Privacy
          </Link>
          <Link href="/login" className="hover:text-emerald-600">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
