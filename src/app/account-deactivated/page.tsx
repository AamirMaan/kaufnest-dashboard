export default function AccountDeactivatedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-(--color-bg) px-4">
      <div className="w-full max-w-md bg-(--color-surface) border border-(--color-border) rounded-[var(--radius-card)] p-8 text-center">
        <h1 className="text-xl font-bold text-(--color-text-strong) mb-3">
          Account Deactivated
        </h1>
        <p className="text-sm text-(--color-text-muted)">
          Your organisation&apos;s KaufNest account has been deactivated.
          Please contact KaufNest support if you believe this is an error.
        </p>
      </div>
    </div>
  );
}
