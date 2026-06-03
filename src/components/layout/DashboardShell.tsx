"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import type { UserRole } from "@/types";

interface Props {
  role: UserRole;
  fullName: string;
  email: string;
  children: React.ReactNode;
}

export function DashboardShell({ role, fullName, email, children }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-[var(--color-surface-subtle)]">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        role={role}
        fullName={fullName}
        email={email}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-auto">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-[var(--color-sidebar-bg)] border-b border-[var(--color-sidebar-border)]">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <span className="text-base font-bold text-white tracking-tight">
            Kauf<span className="text-[var(--color-primary-hover)]">Nest</span>
          </span>
        </div>

        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
