import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Verify this user is a KaufNest platform admin (in control plane)
  const control = createControlClient();
  const { data: adminUser } = await control
    .schema("control")
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .single();

  if (!adminUser) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-[var(--color-surface-subtle)]">
      <header className="sticky top-0 z-10 bg-[var(--color-sidebar-bg)] border-b border-[var(--color-sidebar-border)] px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-base font-bold text-[var(--color-sidebar-text-strong)] tracking-tight">
            Kauf<span className="text-[var(--color-primary-hover)]">Nest</span>
          </span>
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-[var(--color-danger-bg)] text-[var(--color-danger-text)]">
            Admin
          </span>
        </div>
        <a
          href="/dashboard"
          className="text-sm text-[var(--color-sidebar-text)] hover:text-[var(--color-sidebar-text-strong)] transition-colors"
        >
          ← Back to Dashboard
        </a>
      </header>
      <main className="p-6 md:p-8">{children}</main>
    </div>
  );
}
