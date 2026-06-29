interface StatCardProps {
  label: string;
  value: string;
  subtext?: string;
  trend?: "up" | "down" | "neutral";
  icon?: React.ReactNode;
}

export function StatCard({ label, value, subtext, trend, icon }: StatCardProps) {
  const trendColor =
    trend === "up"
      ? "text-(--color-success)"
      : trend === "down"
      ? "text-(--color-danger)"
      : "text-(--color-text-muted)";

  return (
    <div
      className="bg-(--color-surface) rounded-(--radius-card) border border-(--color-border) border-l-4 border-l-(--color-primary) p-5 transition-[box-shadow] duration-150 hover:shadow-lg"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-(--color-text-muted)">{label}</p>
        {icon && <span className="text-(--color-primary)">{icon}</span>}
      </div>
      <p className="mt-1 text-2xl font-bold text-(--color-text-strong) tabular-nums">{value}</p>
      {subtext && (
        <p className={`mt-1 text-xs font-medium ${trendColor}`}>{subtext}</p>
      )}
    </div>
  );
}
