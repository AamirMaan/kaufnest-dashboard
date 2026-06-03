interface StatCardProps {
  label: string;
  value: string;
  subtext?: string;
  trend?: "up" | "down" | "neutral";
}

export function StatCard({ label, value, subtext, trend }: StatCardProps) {
  const trendColor =
    trend === "up"
      ? "text-[var(--color-success)]"
      : trend === "down"
      ? "text-[var(--color-danger)]"
      : "text-[var(--color-text-muted)]";

  return (
    <div
      className="bg-[var(--color-surface)] rounded-[var(--radius-card)] border border-[var(--color-border)] p-5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <p className="text-sm font-medium text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[var(--color-text-strong)] tabular-nums">{value}</p>
      {subtext && (
        <p className={`mt-1 text-xs font-medium ${trendColor}`}>{subtext}</p>
      )}
    </div>
  );
}
