import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { trelloEnv } from "@/lib/support/config";
import { createCard, attachFile } from "@/lib/support/trello";
import { renderCardTitle, renderCardDescription } from "@/lib/support/cardContent";
import { tenantContextFrom, type ControlTenantRow } from "@/lib/support/tenantContext";
import { validateAttachments } from "@/app/dashboard/support/_lib/attachmentRules";
import type { BugAttachment, BugReport, BugReportType, BugSeverity } from "@/types";

// FormData parsing and the Trello upload both need the Node runtime.
export const runtime = "nodejs";

const TYPES: BugReportType[] = ["bug", "feature", "question"];
const SEVERITIES: BugSeverity[] = ["low", "normal", "high", "critical"];

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;
  if (!tenantSchema) {
    return NextResponse.json({ error: "No tenant schema on user" }, { status: 400 });
  }

  const form = await req.formData();
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const type = String(form.get("type") ?? "") as BugReportType;
  const severity = String(form.get("severity") ?? "") as BugSeverity;
  const pageUrl = String(form.get("pageUrl") ?? "").trim() || null;
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (!title || description.length < 20 || !TYPES.includes(type) || !SEVERITIES.includes(severity)) {
    return NextResponse.json(
      { error: "Title, a description of at least 20 characters, type and severity are required." },
      { status: 400 }
    );
  }

  const fileError = validateAttachments(
    files.map((f) => ({ name: f.name, size: f.size, type: f.type }))
  );
  if (fileError) {
    return NextResponse.json({ error: fileError }, { status: 400 });
  }

  const control = createControlClient();
  const { data: tenantRow, error: tenantError } = await control
    .schema("control")
    .from("tenants")
    .select("id, slug, plan")
    .eq("schema_name", tenantSchema)
    .single<ControlTenantRow>();

  if (tenantError || !tenantRow) {
    console.error("[support/report] tenant lookup failed:", tenantError?.message);
    return NextResponse.json({ error: "Could not identify your account." }, { status: 500 });
  }

  const tenant = tenantContextFrom(tenantRow, tenantSchema);

  // Insert FIRST: the report must survive a Trello outage.
  const { data: report, error: insertError } = await control
    .schema("control")
    .from("bug_reports")
    .insert({
      tenant_id: tenant.tenantId,
      reporter_user_id: user.id,
      reporter_email: user.email ?? "unknown",
      type,
      severity,
      title,
      description,
      page_url: pageUrl,
      context: {
        plan: tenant.plan,
        tenant_slug: tenant.slug,
        user_agent: req.headers.get("user-agent"),
      },
    })
    .select("*")
    .single<BugReport>();

  if (insertError || !report) {
    console.error("[support/report] insert failed:", insertError?.message);
    return NextResponse.json({ error: "Could not save your report." }, { status: 500 });
  }

  // Trello is best-effort from here on — never fail the request on its account.
  let warning: string | undefined;
  try {
    const env = trelloEnv();
    const card = await createCard({
      env,
      listId: env.intakeListId,
      name: renderCardTitle(tenant.slug, title),
      desc: renderCardDescription({
        description,
        type,
        severity,
        tenantSlug: tenant.slug,
        plan: tenant.plan,
        reporterEmail: user.email ?? "unknown",
        pageUrl,
        userAgent: req.headers.get("user-agent"),
      }),
    });

    const attachments: BugAttachment[] = [];
    for (const file of files) {
      try {
        attachments.push(await attachFile({ env, cardId: card.id, file }));
      } catch (err) {
        console.error("[support/report] attachment upload failed:", err);
        warning = "Your report was sent, but a screenshot could not be attached. Reply to the report once we're in touch and we'll pick it up.";
      }
    }

    const { error: persistError } = await control
      .schema("control")
      .from("bug_reports")
      .update({
        trello_card_id: card.id,
        trello_card_url: card.url,
        attachments,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", report.id);

    if (persistError) {
      console.error("[support/report] persisting Trello card details failed:", persistError.message);
      warning = warning ?? "Your report was sent, but syncing it with the tracker is still catching up.";
    }

    report.trello_card_id = card.id;
    report.trello_card_url = card.url;
    report.attachments = attachments;
  } catch (err) {
    console.error("[support/report] Trello card creation failed:", err);
    warning = "Your report was saved, but our tracker is unreachable right now. The team will still see it.";
  }

  return NextResponse.json({ report, warning }, { status: 201 });
}
