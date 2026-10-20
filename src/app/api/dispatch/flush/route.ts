import { NextResponse } from "next/server";
import { requireSectionAccess } from "@/lib/permissions/requireSectionAccess";
import { flushDispatchOutbox } from "@/lib/dispatch/flushOutbox";

// The drain loop stops claiming after ~20 s; leave headroom for the last batch.
export const maxDuration = 60;

/**
 * Drains the caller's own tenant's dispatch email queue (057). Any user who
 * can see Orders may trigger it — it only sends emails the DB trigger already
 * queued, and returns counts. Called fire-and-forget by DispatchBanner.
 */
export async function POST() {
  const auth = await requireSectionAccess("orders", 1);
  if (auth.error) return auth.error;

  try {
    const { sent, failed } = await flushDispatchOutbox(auth.context.tenantSchema);
    return NextResponse.json({ sent, failed });
  } catch (e) {
    console.error("[dispatch/flush] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not send dispatch emails" }, { status: 500 });
  }
}
