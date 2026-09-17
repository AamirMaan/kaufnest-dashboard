import { createControlClient } from "@/lib/supabase/control";
import { PageHeader } from "@/components/layout/PageHeader";
import { ResyncButton } from "./_components/ResyncButton";
import { SupportInboxTable } from "./_components/SupportInboxTable";
import type { BugReport, Tenant } from "@/types";

// Server Component: queries the control plane directly (no per-tenant
// listing API exists — see api/support/reports/route.ts, which is scoped to
// the caller's own tenant). Never fetch control-plane data like this from a
// Client Component; createControlClient() is server-only.
export default async function AdminSupportPage() {
  const control = createControlClient();

  const [{ data: reports, error: reportsError }, { data: tenants, error: tenantsError }] =
    await Promise.all([
      control
        .schema("control")
        .from("bug_reports")
        .select("*")
        .order("created_at", { ascending: false })
        .returns<BugReport[]>(),
      control
        .schema("control")
        .from("tenants")
        .select("id, slug")
        .returns<Pick<Tenant, "id" | "slug">[]>(),
    ]);

  if (reportsError) {
    console.error("[admin/support] reports fetch failed:", reportsError.message);
  }
  if (tenantsError) {
    console.error("[admin/support] tenants fetch failed:", tenantsError.message);
  }

  const tenantSlugs: Record<string, string> = {};
  for (const t of tenants ?? []) {
    tenantSlugs[t.id] = t.slug;
  }

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Support Inbox"
        description="Bug reports, feature requests, and questions across every tenant"
        action={<ResyncButton />}
      />

      <SupportInboxTable reports={reports ?? []} tenantSlugs={tenantSlugs} />
    </div>
  );
}
