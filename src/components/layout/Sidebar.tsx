"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  ClipboardList,
  Users,
  Settings,
  User,
  LogOut,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/types";

type LucideIcon = React.ComponentType<{
  size?: number;
  strokeWidth?: number;
  className?: string;
}>;

interface NavItem {
  label: string;
  href: string;
  Icon: LucideIcon;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Overview",
    href: "/dashboard",
    Icon: LayoutDashboard,
    roles: ["super_admin", "admin", "accountant"],
  },
  {
    label: "Sales",
    href: "/dashboard/sales",
    Icon: TrendingUp,
    roles: ["super_admin", "admin", "accountant"],
  },
  {
    label: "Expenses",
    href: "/dashboard/expenses",
    Icon: TrendingDown,
    roles: ["super_admin", "admin", "accountant"],
  },
  {
    label: "Purchases",
    href: "/dashboard/purchases",
    Icon: ShoppingCart,
    roles: ["super_admin", "admin", "accountant"],
  },
  {
    label: "Audit Logs",
    href: "/dashboard/audit-logs",
    Icon: ClipboardList,
    roles: ["super_admin", "admin"],
  },
  {
    label: "Users",
    href: "/dashboard/users",
    Icon: Users,
    roles: ["super_admin"],
  },
  {
    label: "Settings",
    href: "/dashboard/settings",
    Icon: Settings,
    roles: ["super_admin", "admin", "accountant"],
  },
];

interface SidebarProps {
  role: UserRole;
  fullName: string;
  email: string;
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({
  role,
  fullName,
  email,
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));
  const displayName = fullName || email;

  return (
    <aside
      className={[
        // Mobile: fixed overlay sliding in from left
        "fixed md:relative inset-y-0 left-0 z-30",
        "flex flex-col h-full md:min-h-screen",
        "bg-[var(--color-sidebar-bg)] border-r border-[var(--color-sidebar-border)]",
        "transition-[transform,width] duration-300 ease-in-out",
        // Mobile visibility
        mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        // Width: mobile always full, desktop depends on collapsed
        "w-64",
        collapsed ? "md:w-16" : "md:w-64",
      ].join(" ")}
    >
      {/* Brand + controls row */}
      <div
        className={[
          "flex items-center border-b border-[var(--color-sidebar-border)] shrink-0",
          collapsed ? "md:justify-center px-3 py-[18px]" : "justify-between px-5 py-4",
        ].join(" ")}
      >
        {/* Brand text — hidden when collapsed on desktop */}
        <div className={collapsed ? "md:hidden" : ""}>
          <span className="text-xl font-bold text-white tracking-tight">
            Kauf<span className="text-[var(--color-primary-hover)]">Nest</span>
          </span>
          <p className="text-xs text-[var(--color-text-faint)] mt-0.5">Business Dashboard</p>
        </div>

        {/* Desktop: collapse toggle */}
        <button
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden md:flex items-center justify-center p-1.5 rounded-lg text-[var(--color-sidebar-text)] hover:text-white hover:bg-[var(--color-sidebar-border)] transition-colors cursor-pointer"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        {/* Mobile: close button */}
        <button
          onClick={onMobileClose}
          className="md:hidden p-1.5 rounded-lg text-[var(--color-sidebar-text)] hover:text-white hover:bg-[var(--color-sidebar-border)] transition-colors cursor-pointer"
          aria-label="Close navigation"
        >
          <X size={16} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onMobileClose}
              title={collapsed ? item.label : undefined}
              className={[
                "flex items-center gap-3 rounded-[var(--radius-btn)] text-sm font-medium transition-colors",
                // Desktop collapsed: center icon, hide label
                collapsed ? "md:justify-center md:px-0 md:py-2.5 px-3 py-2" : "px-3 py-2",
                isActive
                  ? "bg-[var(--color-sidebar-active)] text-white"
                  : "text-[var(--color-sidebar-text)] hover:text-white hover:bg-[var(--color-sidebar-border)]",
              ].join(" ")}
            >
              <item.Icon size={18} strokeWidth={1.75} className="shrink-0" />
              <span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div
        className={[
          "shrink-0 border-t border-[var(--color-sidebar-border)]",
          collapsed ? "px-2 py-3 flex flex-col items-center gap-2" : "px-4 py-3 space-y-2",
        ].join(" ")}
      >
        {/* User info row — hidden when collapsed on desktop */}
        <div className={["flex items-center gap-3", collapsed ? "md:hidden" : "px-1"].join(" ")}>
          <div className="shrink-0 w-8 h-8 rounded-full bg-[var(--color-sidebar-border)] flex items-center justify-center">
            <User size={15} className="text-[var(--color-primary-hover)]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate leading-tight">{displayName}</p>
            <p className="text-xs text-[var(--color-text-faint)] truncate">{email}</p>
            <span className="inline-block mt-0.5 px-1.5 py-px rounded text-[10px] font-medium bg-[var(--color-sidebar-border)] text-[var(--color-primary-hover)]">
              {role.replace("_", " ")}
            </span>
          </div>
        </div>

        {/* Collapsed user avatar (desktop only) */}
        <div
          title={`${displayName} · ${role.replace("_", " ")}`}
          className={[
            "w-8 h-8 rounded-full bg-[var(--color-sidebar-border)] items-center justify-center",
            collapsed ? "md:flex hidden" : "hidden",
          ].join(" ")}
        >
          <User size={15} className="text-[var(--color-primary-hover)]" />
        </div>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          title={collapsed ? "Sign out" : undefined}
          className={[
            "flex items-center gap-2.5 rounded-[var(--radius-btn)] text-sm transition-colors cursor-pointer",
            "text-[var(--color-sidebar-text)] hover:text-red-400 hover:bg-[var(--color-sidebar-border)]",
            collapsed ? "md:justify-center md:p-2.5 w-full px-3 py-2" : "w-full px-3 py-2",
          ].join(" ")}
        >
          <LogOut size={16} strokeWidth={1.75} className="shrink-0" />
          <span className={collapsed ? "md:hidden" : ""}>Sign out</span>
        </button>
      </div>
    </aside>
  );
}


