import Link from "next/link";

export default function TrialExpiredPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-(--color-bg) px-4">
      <div className="w-full max-w-md bg-(--color-surface) border border-(--color-border) rounded-[var(--radius-card)] p-8 text-center">
        <h1 className="text-xl font-bold text-(--color-text-strong) mb-3">
          Your free trial has ended
        </h1>
        <p className="text-sm text-(--color-text-muted)">
          Your 14-day Boughtopia trial is over. All of your data is safe and
          will be exactly as you left it as soon as you choose a plan.
        </p>
        <p className="mt-4 text-sm text-(--color-text-muted)">
          Contact Boughtopia to pick a plan and get straight back in.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm font-medium text-(--color-primary) hover:underline"
        >
          View plans &amp; pricing →
        </Link>
      </div>
    </div>
  );
}
