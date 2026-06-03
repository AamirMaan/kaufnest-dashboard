"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { UserRole } from "@/types";

interface NavItem {
  label: string;
  href: string;
  icon: string;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Overview",
    href: "/dashboard",
    icon: "⊞",
    roles: ["super_admin", "admin", "accountant"],
  },
  {
    label: "Sales",
    href: "/dashboard/sales",
    icon: "↑",
    roles: ["super_admin", "admin", "accountant"],
  },
  {
    label: "Expenses",
    href: "/dashboard/expenses",
    icon: "↓",
    roles: ["super_admin", "admin", "accountant"],
  },
  {
    label: "Purchases",
    href: "/dashboard/purchases",
    icon: "◈",
    roles: ["super_admin", "admin", "accountant"],
  },
  {
    label: "Audit Logs",
    href: "/dashboard/audit-logs",
    icon: "≡",
    roles: ["super_admin", "admin"],
  },
  {
    label: "Users",
    href: "/dashboard/users",
    icon: "◉",
    roles: ["super_admin"],
  },
  {
    label: "Settings",
    href: "/dashboard/settings",
    icon: "⚙",
    roles: ["super_admin", "admin", "accountant"],
  },
];

interface SidebarProps {
  role: UserRole;
  fullName: string;
  email: string;
}

export function Sidebar({ role, fullName, email }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <aside className="w-64 min-h-screen bg-[var(--color-sidebar-bg)] border-r border-[var(--color-sidebar-border)] flex flex-col">
      {/* Brand */}
      <div className="px-6 py-5 border-b border-[var(--color-sidebar-border)]">
        <span className="text-xl font-bold text-white tracking-tight">
          Kauf<span className="text-[var(--color-primary-hover)]">Nest</span>
        </span>
        <p className="text-xs text-[var(--color-text-faint)] mt-0.5">Business Dashboard</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {visibleItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-[var(--radius-btn)] text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[var(--color-sidebar-active)] text-white"
                  : "text-[var(--color-sidebar-text)] hover:text-white hover:bg-[var(--color-sidebar-border)]"
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User info + sign-out */}
      <div className="px-4 py-4 border-t border-[var(--color-sidebar-border)] space-y-2">
        <div className="px-2">
          <p className="text-sm font-medium text-white truncate">{fullName || email}</p>
          <p className="text-xs text-[var(--color-text-faint)] truncate">{email}</p>
          <span className="inline-block mt-1 px-2 py-0.5 rounded-[var(--radius-badge)] text-xs font-medium bg-[var(--color-sidebar-border)] text-[var(--color-primary-hover)]">
            {role.replace("_", " ")}
          </span>
        </div>
        <button
          onClick={handleSignOut}
          className="w-full text-left px-3 py-2 rounded-[var(--radius-btn)] text-sm text-[var(--color-sidebar-text)] hover:text-white hover:bg-[var(--color-sidebar-border)] transition-colors cursor-pointer"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
