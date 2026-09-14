import type { BugReport, BugReportReply } from "@/types";

/**
 * Control-plane rows carry no RLS for tenant users, so every read path must
 * make this check explicitly. Callers turn `false` into a 404, never a 403 —
 * confirming that an id exists is itself a leak.
 */
export function assertReportVisible(
  report: Pick<BugReport, "tenant_id"> | null,
  tenantId: string
): boolean {
  return !!report && report.tenant_id === tenantId;
}

export function attachReplies(reports: BugReport[], replies: BugReportReply[]): BugReport[] {
  const byReport = new Map<string, BugReportReply[]>();
  for (const reply of replies) {
    const list = byReport.get(reply.report_id) ?? [];
    list.push(reply);
    byReport.set(reply.report_id, list);
  }

  for (const list of byReport.values()) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  return reports.map((r) => ({ ...r, replies: byReport.get(r.id) ?? [] }));
}
