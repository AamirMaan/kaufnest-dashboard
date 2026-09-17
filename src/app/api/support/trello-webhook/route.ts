import { NextRequest, NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";
import { createServiceClientForTenant } from "@/lib/supabase/server";
import { trelloEnv } from "@/lib/support/config";
import { verifyWebhookSignature } from "@/lib/support/signature";
import { interpretAction, type TrelloAction } from "@/lib/support/webhookActions";
import { notifyReporter } from "@/lib/support/notify";
import type { BugReport, UserRole } from "@/types";

export const runtime = "nodejs";

/** Trello HEADs the callback URL when the webhook is registered. */
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

export async function POST(req: NextRequest) {
  const env = trelloEnv();
  const raw = await req.text();

  if (!verifyWebhookSignature(raw, req.headers.get("x-trello-webhook"), env.secret, env.callbackUrl)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let action: TrelloAction;
  try {
    action = (JSON.parse(raw) as { action: TrelloAction }).action;
  } catch {
    return NextResponse.json({ ok: true });
  }
  if (!action) return NextResponse.json({ ok: true });

  const interpreted = interpretAction(action, env.statusMap);
  if (interpreted.kind === "ignore") return NextResponse.json({ ok: true });

  const control = createControlClient();
  const { data: report } = await control
    .schema("control").from("bug_reports").select("*")
    .eq("trello_card_id", interpreted.cardId).maybeSingle<BugReport>();

  // A card created by hand on the board has no report — nothing to do.
  if (!report) return NextResponse.json({ ok: true });

  const { data: tenant } = await control
    .schema("control").from("tenants").select("schema_name")
    .eq("id", report.tenant_id).single<{ schema_name: string }>();
  if (!tenant) return NextResponse.json({ ok: true });

  let detail: string;

  if (interpreted.kind === "status") {
    if (report.status === interpreted.status) return NextResponse.json({ ok: true });

    const { error } = await control
      .schema("control").from("bug_reports")
      .update({
        status: interpreted.status,
        updated_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", report.id);

    if (error) {
      console.error("[support/webhook] status update failed:", error.message);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    report.status = interpreted.status;
    detail = report.title;
  } else {
    // trello_comment_id is unique: a redelivered comment is a no-op insert.
    const { error } = await control
      .schema("control").from("bug_report_replies")
      .insert({
        report_id: report.id,
        body: interpreted.body,
        author: interpreted.author,
        trello_comment_id: interpreted.commentId,
      });

    if (error) {
      // 23505 = unique violation = Trello replayed this comment. Not an error.
      if (error.code === "23505") return NextResponse.json({ ok: true });
      console.error("[support/webhook] reply insert failed:", error.message);
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }

    detail = interpreted.body;
  }

  const tenantDb = createServiceClientForTenant(tenant.schema_name);
  const { data: profile } = await tenantDb
    .from("profiles").select("role").eq("id", report.reporter_user_id)
    .maybeSingle<{ role: UserRole }>();

  await notifyReporter({
    schema: tenant.schema_name,
    report,
    reporterRole: profile?.role ?? null,
    kind: interpreted.kind,
    detail,
  });

  return NextResponse.json({ ok: true });
}
