import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { attachReplies } from "@/lib/support/authorizeReport";
import type { BugReport, BugReportReply } from "@/types";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json({ error: "No tenant schema on user" }, { status: 400 });
  }

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("id")
    .eq("schema_name", tenantSchema)
    .single<{ id: string }>();

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const { data: reports, error } = await control
    .schema("control")
    .from("bug_reports")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .returns<BugReport[]>();

  if (error) {
    console.error("[support/reports] list failed:", error.message);
    return NextResponse.json({ error: "Could not load your reports." }, { status: 500 });
  }

  const ids = (reports ?? []).map((r) => r.id);
  const { data: replies } = ids.length
    ? await control
        .schema("control")
        .from("bug_report_replies")
        .select("*")
        .in("report_id", ids)
        .returns<BugReportReply[]>()
    : { data: [] as BugReportReply[] };

  return NextResponse.json({ reports: attachReplies(reports ?? [], replies ?? []) });
}
