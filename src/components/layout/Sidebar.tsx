"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  ClipboardList,
  Users,
  Settings,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
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
  const displayName = fullName || email;

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <aside
      className={[
        // Mobile: fixed overlay sliding in from left (covers full screen height incl. header)
        "fixed md:relative inset-y-0 left-0 z-30",
        "flex flex-col h-full",
        "bg-[var(--color-sidebar-bg)] border-r border-[var(--color-sidebar-border)]",
        "transition-[transform,width] duration-300 ease-in-out",
        mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        "w-64",
        collapsed ? "md:w-16" : "md:w-64",
      ].join(" ")}
    >
      {/* Desktop collapse toggle — floats on the right edge of the sidebar */}
      <button
        onClick={onToggle}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="hidden md:flex absolute right-0 translate-x-1/2 top-[72px] w-6 h-6 rounded-full items-center justify-center bg-[var(--color-sidebar-bg)] border border-[var(--color-sidebar-border)] text-[var(--color-sidebar-text)] hover:text-white hover:border-[var(--color-primary)] transition-colors cursor-pointer z-10 shadow-sm"
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
      </button>

      {/* Mobile-only header: brand + close button */}
      <div className="md:hidden flex items-center justify-between px-5 h-14 border-b border-[var(--color-sidebar-border)] shrink-0">
        <div>
          <span className="text-xl font-bold text-white tracking-tight">
            Kauf<span className="text-[var(--color-primary-hover)]">Nest</span>
          </span>
          <p className="text-xs text-[var(--color-text-faint)] mt-0.5">Business Dashboard</p>
        </div>
        <button
          onClick={onMobileClose}
          className="p-1.5 rounded-lg text-[var(--color-sidebar-text)] hover:text-white hover:bg-[var(--color-sidebar-border)] transition-colors cursor-pointer"
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
    </aside>
  );
}


