"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  Boxes,
  ClipboardList,
  Users,
  Settings,
  Shield,
  Plug,
  Calculator,
  Package,
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
    label: "Orders",
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
    label: "Inventory",
    href: "/dashboard/inventory",
    Icon: Boxes,
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
    label: "Integrations",
    href: "/dashboard/integrations",
    Icon: Plug,
    roles: ["super_admin", "admin", "accountant"],
  },
  {
    label: "Dropshipping",
    href: "/dashboard/dropshipping",
    Icon: Package,
    roles: ["super_admin", "admin", "accountant"],
  },
  {
    label: "Planner",
    href: "/dashboard/planner",
    Icon: Calculator,
    roles: ["super_admin", "admin", "accountant"],
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
  isPlatformAdmin?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({
  role,
  isPlatformAdmin,
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));
  const showAdminLink = role === "super_admin" && isPlatformAdmin;

  return (
    <aside
      className={[
        "fixed md:relative inset-y-0 left-0 z-30",
        "flex flex-col h-full",
        "bg-(--color-sidebar-bg) border-r border-(--color-sidebar-border)",
        "transition-[transform,width] duration-300 ease-in-out",
        mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        "w-64",
        collapsed ? "md:w-16" : "md:w-64",
      ].join(" ")}
    >
      {/* Desktop collapse toggle */}
      <button
        onClick={onToggle}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="hidden md:flex absolute right-0 translate-x-1/2 top-[72px] w-6 h-6 rounded-full items-center justify-center bg-(--color-sidebar-bg) border border-(--color-sidebar-border) text-(--color-sidebar-text) hover:text-(--color-sidebar-text-strong) hover:border-(--color-primary) transition-colors duration-150 cursor-pointer z-10 shadow-sm"
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
      </button>

      {/* Mobile-only header */}
      <div className="md:hidden flex items-center justify-between px-5 h-14 border-b border-(--color-sidebar-border) shrink-0">
        <div>
          <span className="text-xl font-bold text-(--color-sidebar-text-strong) tracking-tight">
            Kauf<span className="text-(--color-primary-hover)">Nest</span>
          </span>
          <p className="text-xs text-(--color-sidebar-text) mt-0.5">Business Dashboard</p>
        </div>
        <button
          onClick={onMobileClose}
          className="p-1.5 rounded-lg text-(--color-sidebar-text) hover:text-(--color-sidebar-text-strong) hover:bg-(--color-sidebar-hover) transition-colors duration-150 cursor-pointer"
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
                "flex items-center gap-3 rounded-(--radius-btn) text-sm font-medium transition-colors duration-150",
                collapsed ? "md:justify-center md:px-0 md:py-2.5 px-3 py-2" : "px-3 py-2",
                isActive
                  ? "bg-(--color-primary)/15 text-(--color-sidebar-active-text)"
                  : "text-(--color-sidebar-text) hover:text-(--color-sidebar-text-strong) hover:bg-(--color-sidebar-hover)",
              ].join(" ")}
            >
              <item.Icon size={18} strokeWidth={1.75} className="shrink-0" />
              <span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
            </Link>
          );
        })}

        {showAdminLink && (
          <Link
            href="/admin"
            onClick={onMobileClose}
            title={collapsed ? "Admin Panel" : undefined}
            className={[
              "flex items-center gap-3 rounded-(--radius-btn) text-sm font-medium transition-colors duration-150",
              "mt-2 pt-2 border-t border-(--color-sidebar-border)",
              collapsed ? "md:justify-center md:px-0 md:py-2.5 px-3 py-2" : "px-3 py-2",
              pathname.startsWith("/admin")
                ? "bg-(--color-primary)/15 text-(--color-sidebar-active-text)"
                : "text-(--color-sidebar-text) hover:text-(--color-sidebar-text-strong) hover:bg-(--color-sidebar-hover)",
            ].join(" ")}
          >
            <Shield size={18} strokeWidth={1.75} className="shrink-0" />
            <span className={collapsed ? "md:hidden" : ""}>Admin Panel</span>
          </Link>
        )}
      </nav>
    </aside>
  );
}
