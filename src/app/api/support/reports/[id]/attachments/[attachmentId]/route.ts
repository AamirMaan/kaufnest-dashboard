import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { trelloEnv } from "@/lib/support/config";
import { downloadAttachment } from "@/lib/support/trello";
import { assertReportVisible } from "@/lib/support/authorizeReport";
import type { BugReport } from "@/types";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id, attachmentId } = await ctx.params;

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

  if (!assertReportVisible(report, tenant.id) || !report?.trello_card_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = (report.attachments ?? []).find((a) => a.id === attachmentId);
  if (!meta) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const file = await downloadAttachment({
      env: trelloEnv(),
      cardId: report.trello_card_id,
      attachmentId,
      fileName: meta.name,
    });

    return new NextResponse(file.body, {
      headers: {
        "Content-Type": file.contentType,
        // Private: this is one tenant's screenshot, never a shared CDN object.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[support/attachments] download failed:", err);
    return NextResponse.json({ error: "Could not load the screenshot." }, { status: 502 });
  }
}
