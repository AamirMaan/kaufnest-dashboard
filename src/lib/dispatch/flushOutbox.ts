import { createServiceClientForTenant } from "@/lib/supabase/server";
import { isSmtpConfigured, sendMail } from "@/lib/email/smtp";
import { processOutboxUntilDrained, type ClaimedDispatchEmail } from "./processOutbox";

/** Per-request drain budget: whichever is hit first. */
const FLUSH_MAX_BATCHES = 5;
const FLUSH_DEADLINE_MS = 20_000;

/**
 * Drains one tenant's dispatch_email_outbox (057). Server-only. Service role:
 * the outbox has no client grants. No-ops when SMTP isn't configured, so dev
 * never errors and rows stay pending until a configured environment flushes.
 * Claims batches of 10 until one comes back short, within the budget above.
 */

export async function flushDispatchOutbox(schema: string) {
  if (!isSmtpConfigured()) return { sent: 0, failed: 0, skipped: 0, configured: false };

  const db = createServiceClientForTenant(schema);
  const { sent, failed, skipped } = await processOutboxUntilDrained({
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
        // claimed_at is kept: the 5-minute claim lease is the retry backoff.
        // Clearing it let the same flush re-claim the row at once.
        .update({ last_error: message })
        .eq("id", id);
      if (error) console.error("[dispatch] markFailed failed", id, error.message);
    },
    async release(ids) {
      const { error } = await db.rpc("release_dispatch_emails", { p_ids: ids });
      // Not fatal: unreleased rows just wait out their 5-minute lease.
      if (error) console.error("[dispatch] release failed", ids.length, error.message);
    },
    send: sendMail,
    // Same base-URL convention as the invite/provision emails: an empty
    // fallback would put relative (dead) links into the email.
    appUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.boughtopia.com",
  }, { maxBatches: FLUSH_MAX_BATCHES, deadlineMs: FLUSH_DEADLINE_MS });
  return { sent, failed, skipped, configured: true };
}
