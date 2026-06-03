import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { StoreProvider } from "@/store/StoreProvider";
import { ToastProvider } from "@/components/ui/Toast";
import type { Profile, Sale, Expense, Purchase, AuditLog } from "@/types";

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

  // Fetch all collections once — hydrated into Redux so pages never refetch.
  const [
    { data: sales },
    { data: expenses },
    { data: purchases },
    { data: auditLogs },
    { data: users },
  ] = await Promise.all([
    supabase
      .from("sales")
      .select("*")
      .order("date", { ascending: false })
      .limit(100)
      .returns<Sale[]>(),
    supabase
      .from("expenses")
      .select("*")
      .order("date", { ascending: false })
      .limit(100)
      .returns<Expense[]>(),
    supabase
      .from("purchases")
      .select("*")
      .order("date", { ascending: false })
      .limit(100)
      .returns<Purchase[]>(),
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
  ]);

  return (
    <StoreProvider
      sales={sales ?? []}
      expenses={expenses ?? []}
      purchases={purchases ?? []}
      auditLogs={auditLogs ?? []}
      users={users ?? []}
      currentUser={profile}
    >
      <ToastProvider>
        <DashboardShell
          role={profile.role}
          fullName={profile.full_name}
          email={profile.email}
        >
          {children}
        </DashboardShell>
      </ToastProvider>
    </StoreProvider>
  );
}
