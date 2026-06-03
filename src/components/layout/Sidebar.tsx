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
    <aside className="w-64 min-h-screen bg-slate-900 border-r border-slate-800 flex flex-col">
      {/* Brand */}
      <div className="px-6 py-5 border-b border-slate-800">
        <span className="text-xl font-bold text-white tracking-tight">
          Kauf<span className="text-indigo-400">Nest</span>
        </span>
        <p className="text-xs text-slate-500 mt-0.5">Business Dashboard</p>
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
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User info + sign-out */}
      <div className="px-4 py-4 border-t border-slate-800 space-y-2">
        <div className="px-2">
          <p className="text-sm font-medium text-white truncate">{fullName || email}</p>
          <p className="text-xs text-slate-500 truncate">{email}</p>
          <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-indigo-300">
            {role.replace("_", " ")}
          </span>
        </div>
        <button
          onClick={handleSignOut}
          className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
