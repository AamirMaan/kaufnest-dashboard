"use client";

import { Badge } from "@/components/ui/Badge";
import type { BugReport, BugSeverity } from "@/types";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

const SEVERITY_VARIANT: Record<BugSeverity, BadgeVariant> = {
  critical: "danger",
  high: "warning",
  normal: "info",
  low: "default",
};

export function ReportCard({ report, onOpen }: { report: BugReport; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left p-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) hover:border-(--color-primary) transition-colors cursor-pointer"
    >
      <p className="text-sm font-semibold text-(--color-text-strong) line-clamp-2">{report.title}</p>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <Badge label={report.type} />
        <Badge label={report.severity} variant={SEVERITY_VARIANT[report.severity]} />
        {report.attachments.length > 0 && (
          <span className="text-[11px] text-(--color-text-muted)">
            {report.attachments.length} screenshot{report.attachments.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <p className="text-xs text-(--color-text-muted) mt-2">
        {report.reporter_email} · {new Date(report.created_at).toLocaleDateString()}
        {report.replies && report.replies.length > 0 && ` · ${report.replies.length} reply`}
      </p>
    </button>
  );
}
