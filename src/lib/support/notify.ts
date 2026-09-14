import { createServiceClientForTenant } from "@/lib/supabase/server";
import type { BugReport, NotificationType, UserRole } from "@/types";

const STATUS_WORDS: Record<string, string> = {
  reported: "reported",
  in_progress: "in progress",
  fixed: "fixed",
  wont_fix: "closed as won't fix",
};

/**
 * Writes a bell notification into the reporting tenant's schema.
 *
 * Two things here are load-bearing:
 *  - `actor_id` is null. `isUnread()` suppresses notifications caused by the
 *    current user, so stamping the reporter's id would hide the update from
 *    the one person who asked for it. The Boughtopia team is external to the
 *    tenant, exactly like an inbound buyer message.
 *  - The service-role key bypasses RLS, which is why this can insert at all —
 *    `028_notifications.sql` deliberately grants `authenticated` no insert
 *    policy so users cannot forge notifications. That invariant still holds.
 */
export async function notifyReporter(args: {
  schema: string;
  report: BugReport;
  reporterRole: UserRole | null;
  kind: "status" | "reply";
  detail: string;
}): Promise<void> {
  const { schema, report, reporterRole, kind, detail } = args;

  const roles = Array.from(
    new Set<UserRole>([...(reporterRole ? [reporterRole] : []), "admin", "super_admin"])
  );

  const type: NotificationType =
    kind === "status" ? "support.status_changed" : "support.replied";

  const title =
    kind === "status"
      ? `Your report is ${STATUS_WORDS[report.status] ?? report.status}`
      : "Support replied to your report";

  const supabase = createServiceClientForTenant(schema);
  const { error } = await supabase.from("notifications").insert({
    type,
    category: "support",
    entity_type: "bug_report",
    entity_id: report.id,
    title,
    body: detail.slice(0, 500),
    link: "/dashboard/support",
    payload: { report_id: report.id, status: report.status, title: report.title },
    actor_id: null,
    visible_to_roles: roles,
    required_permission: null,
  });

  if (error) {
    // A missing notification must not fail the webhook — Trello would retry
    // the whole action and duplicate the reply.
    console.error("[support/notify] insert failed:", error.message);
  }
}
