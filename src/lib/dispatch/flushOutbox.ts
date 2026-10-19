import { createServiceClientForTenant } from "@/lib/supabase/server";
import { isSmtpConfigured, sendMail } from "@/lib/email/smtp";
import { processOutbox, type ClaimedDispatchEmail } from "./processOutbox";

/**
 * Drains one tenant's dispatch_email_outbox (057). Server-only. Service role:
 * the outbox has no client grants. No-ops when SMTP isn't configured, so dev
 * never errors and rows stay pending until a configured environment flushes.
 */
export async function flushDispatchOutbox(schema: string) {
  if (!isSmtpConfigured()) return { sent: 0, failed: 0, skipped: 0, configured: false };

  const db = createServiceClientForTenant(schema);
  const result = await processOutbox({
    async claim(limit) {
      const { data, error } = await db.rpc("claim_dispatch_emails", { p_limit: limit });
      if (error) throw new Error(`claim_dispatch_emails: ${error.message}`);
      return (data ?? []) as ClaimedDispatchEmail[];
    },
    async markSent(id, note) {
      const { error } = await db
        .from("dispatch_email_outbox")
        .update({ sent_at: new Date().toISOString(), last_error: note })
        .eq("id", id);
      if (error) console.error("[dispatch] markSent failed", id, error.message);
    },
    async markFailed(id, message) {
      const { error } = await db
        .from("dispatch_email_outbox")
        .update({ last_error: message, claimed_at: null })
        .eq("id", id);
      if (error) console.error("[dispatch] markFailed failed", id, error.message);
    },
    send: sendMail,
    // Same base-URL convention as the invite/provision emails: an empty
    // fallback would put relative (dead) links into the email.
    appUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.boughtopia.com",
  });
  return { ...result, configured: true };
}
