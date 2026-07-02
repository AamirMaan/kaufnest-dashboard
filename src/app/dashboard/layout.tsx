import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createControlClient, isPlatformAdmin } from "@/lib/supabase/control";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { StoreProvider } from "@/store/StoreProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { DEFAULT_PAGE_SIZE } from "@/lib/utils/pagedQuery";
import type {
  Profile,
  Sale,
  Expense,
  Purchase,
  Product,
  AuditLog,
  CompanyProfile,
  TenantPlan,
  PlatformConnection,
  DropshipListing,
} from "@/types";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) redirect("/login");

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;

  // Fetch all collections once — hydrated into Redux so pages never refetch.
  const [
    { data: salesData, count: salesCount },
    { data: expensesData, count: expensesCount },
    { data: purchasesData, count: purchasesCount },
    { data: products },
    { data: auditLogs },
    { data: users },
    { data: companyProfile },
    { data: platformConnections },
    { data: dropshipListings },
  ] = await Promise.all([
    supabase
      .from("sales")
      .select("*", { count: "exact" })
      .order("date", { ascending: false })
      .range(0, DEFAULT_PAGE_SIZE - 1)
      .returns<Sale[]>(),
    supabase
      .from("expenses")
      .select("*", { count: "exact" })
      .order("date", { ascending: false })
      .range(0, DEFAULT_PAGE_SIZE - 1)
      .returns<Expense[]>(),
    supabase
      .from("purchases")
      .select("*", { count: "exact" })
      .order("date", { ascending: false })
      .range(0, DEFAULT_PAGE_SIZE - 1)
      .returns<Purchase[]>(),
    supabase
      .from("products")
      .select("*")
      .order("name", { ascending: true })
      .returns<Product[]>(),
    supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
      .returns<AuditLog[]>(),
    supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true })
      .returns<Profile[]>(),
    supabase
      .from("company_profile")
      .select("*")
      .single<CompanyProfile>(),
    // Columns are listed explicitly to exclude access_token/refresh_token/
    // token_expires_at — those never leave the server (see
    // src/lib/integrations/SKILL.md). RLS restricts this to admin/super_admin,
    // so other roles get an empty array here.
    supabase
      .from("platform_connections")
      .select(
        "id, platform, status, external_account_id, marketplace_id, last_synced_at, last_sync_status, last_sync_error, updated_at"
      )
      .returns<PlatformConnection[]>(),
    supabase
      .from("dropship_listings")
      .select("*")
      .order("created_at", { ascending: false })
      .returns<DropshipListing[]>(),
  ]);

  // Read impersonation cookie — set by /api/admin/impersonate
  const cookieStore = await cookies();
  const impersonatingTenant = cookieStore.get("kaufnest_impersonating")?.value ?? null;

  // KaufNest platform admin? Drives the "Admin Panel" sidebar link.
  const isAdmin = await isPlatformAdmin(user.email);

  // Tenant's subscription plan — drives platform-integrations gating.
  let tenantPlan: TenantPlan | null = null;
  if (tenantSchema) {
    const control = createControlClient();
    const { data: tenant } = await control
      .schema("control")
      .from("tenants")
      .select("plan")
      .eq("schema_name", tenantSchema)
      .single();
    tenantPlan = (tenant?.plan as TenantPlan | undefined) ?? null;
  }

  return (
    <StoreProvider
      sales={{ data: salesData ?? [], count: salesCount ?? 0 }}
      expenses={{ data: expensesData ?? [], count: expensesCount ?? 0 }}
      purchases={{ data: purchasesData ?? [], count: purchasesCount ?? 0 }}
      products={products ?? []}
      auditLogs={auditLogs ?? []}
      users={users ?? []}
      currentUser={profile}
      companyProfile={companyProfile ?? undefined}
      tenantPlan={tenantPlan}
      platformConnections={platformConnections ?? []}
      dropshipListings={dropshipListings ?? []}
    >
      <ToastProvider>
        <DashboardShell
          role={profile.role}
          fullName={profile.full_name}
          email={profile.email}
          impersonatingTenant={impersonatingTenant}
          isPlatformAdmin={isAdmin}
        >
          {children}
        </DashboardShell>
      </ToastProvider>
    </StoreProvider>
  );
}
