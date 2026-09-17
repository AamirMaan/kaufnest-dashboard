import type { BugReport, BugReportStatus } from "@/types";

/** Left-to-right board order. */
export const STATUS_COLUMNS: BugReportStatus[] = [
  "reported",
  "in_progress",
  "fixed",
  "wont_fix",
];

export const STATUS_LABELS: Record<BugReportStatus, string> = {
  reported: "Reported",
  in_progress: "In Progress",
  fixed: "Fixed",
  wont_fix: "Won't Fix",
};

export const STATUS_EMPTY_MESSAGES: Record<BugReportStatus, string> = {
  reported: "Nothing waiting to be picked up.",
  in_progress: "Nothing being worked on right now.",
  fixed: "Nothing fixed yet.",
  wont_fix: "Nothing closed.",
};

export function groupByStatus(reports: BugReport[]): Record<BugReportStatus, BugReport[]> {
  const grouped = Object.fromEntries(
    STATUS_COLUMNS.map((status) => [status, [] as BugReport[]])
  ) as Record<BugReportStatus, BugReport[]>;

  for (const report of reports) {
    (grouped[report.status] ?? grouped.reported).push(report);
  }

  for (const status of STATUS_COLUMNS) {
    grouped[status].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  return grouped;
}
