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
  PlatformPayout,
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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) {
    // Log why before redirecting — a silent redirect here is undebuggable
    // (proxy.ts declines to bounce profile-less sessions back to /dashboard,
    // so this lands on /login rather than looping).
    console.error("[dashboard/layout] profile fetch returned null", {
      userId: user.id,
      tenantSchema: user.app_metadata?.tenant_schema ?? "(none — public)",
      error: profileError,
    });
    redirect("/login");
  }

  const tenantSchema = user.app_metadata?.tenant_schema as string | undefined;

  // Fetch all collections once — hydrated into Redux so pages never refetch.
  // Products are fetched twice:
  //   1. Paginated (first page only) — for the inventory table.
  //   2. Lightweight selector list (all, id/name/current_stock/sku) — for
  //      product-link dropdowns in Sales/Purchases modals.
  const [
    { data: salesData, count: salesCount },
    { data: expensesData, count: expensesCount },
    { data: purchasesData, count: purchasesCount },
    { data: productsPage, count: productsCount },
    { data: productSelectors },
    { data: auditLogs, count: auditLogsCount },
    { data: users },
    { data: companyProfile },
    { data: platformConnections },
    { data: dropshipListings },
    { data: platformPayoutsData },
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
    // Paginated product table — first page only.
    supabase
      .from("products")
      .select("*", { count: "exact" })
      .order("name", { ascending: true })
      .range(0, DEFAULT_PAGE_SIZE - 1)
      .returns<Product[]>(),
    // Lightweight selector list — all products, minimal columns for dropdowns.
    supabase
      .from("products")
      .select("id, name, current_stock, sku")
      .order("name", { ascending: true }),
    supabase
      .from("audit_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(0, DEFAULT_PAGE_SIZE - 1)
      .returns<AuditLog[]>(),
    supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true })
      .returns<Profile[]>(),
    supabase
      .from("company_profile")
      .select("*")
      .maybeSingle<CompanyProfile>(),
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
    supabase
      .from("platform_payouts")
      .select("*")
      .order("date", { ascending: false })
      .returns<PlatformPayout[]>(),
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
      products={{ data: productsPage ?? [], count: productsCount ?? 0 }}
      productSelectors={productSelectors ?? []}
      auditLogs={{ data: auditLogs ?? [], count: auditLogsCount ?? 0 }}
      users={users ?? []}
      currentUser={profile}
      companyProfile={companyProfile ?? undefined}
      tenantPlan={tenantPlan}
      platformConnections={platformConnections ?? []}
      dropshipListings={dropshipListings ?? []}
      platformPayouts={platformPayoutsData ?? []}
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
