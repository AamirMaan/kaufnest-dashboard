import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { trelloEnv } from "@/lib/support/config";
import { attachFile } from "@/lib/support/trello";
import { assertReportVisible } from "@/lib/support/authorizeReport";
import { validateAttachments } from "@/app/dashboard/support/_lib/attachmentRules";
import type { BugAttachment, BugReport } from "@/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json({ error: "No tenant schema on user" }, { status: 400 });
  }

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control").from("tenants").select("id")
    .eq("schema_name", tenantSchema).single<{ id: string }>();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const { data: report } = await control
    .schema("control").from("bug_reports").select("*")
    .eq("id", id).single<BugReport>();

  // Another tenant's id answers 404, never 403 — a 403 confirms it exists.
  if (!assertReportVisible(report, tenant.id) || !report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
  if (!report.trello_card_id) {
    return NextResponse.json(
      { error: "This report isn't in the tracker yet. Try again shortly." },
      { status: 409 }
    );
  }

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const existing = report.attachments ?? [];

  const fileError = validateAttachments(
    [...existing.map((a) => ({ name: a.name, size: a.bytes, type: a.mime })),
     ...files.map((f) => ({ name: f.name, size: f.size, type: f.type }))]
  );
  if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });

  const env = trelloEnv();
  const added: BugAttachment[] = [];
  try {
    for (const file of files) {
      added.push(await attachFile({ env, cardId: report.trello_card_id, file }));
    }
  } catch (err) {
    console.error("[support/attachments] upload failed:", err);
    return NextResponse.json({ error: "Could not attach the screenshot." }, { status: 502 });
  }

  const attachments = [...existing, ...added];
  await control
    .schema("control").from("bug_reports")
    .update({ attachments, updated_at: new Date().toISOString() })
    .eq("id", report.id);

  return NextResponse.json({ attachments });
}
