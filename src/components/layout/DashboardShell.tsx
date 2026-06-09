"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Menu, User, LogOut, ChevronDown, Moon, Sun } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Sidebar } from "./Sidebar";
import { useTheme } from "@/components/ui/ThemeProvider";
import type { UserRole } from "@/types";

interface Props {
  role: UserRole;
  fullName: string;
  email: string;
  children: React.ReactNode;
  impersonatingTenant?: string | null;
}

export function DashboardShell({ role, fullName, email, children, impersonatingTenant }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { theme, toggle: toggleTheme } = useTheme();
  const router = useRouter();
  const displayName = fullName || email;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function exitImpersonation() {
    await fetch("/api/admin/exit-impersonation", { method: "POST" });
    window.location.href = "/admin";
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--color-surface-subtle)]">
      {/* Impersonation banner — only shown when a KaufNest admin is viewing a tenant */}
      {impersonatingTenant && (
        <div className="shrink-0 bg-amber-500 text-white text-xs font-medium px-4 py-1.5 flex items-center justify-between z-20">
          <span>Impersonating tenant: <strong>{impersonatingTenant}</strong></span>
          <button
            onClick={exitImpersonation}
            className="underline hover:no-underline cursor-pointer"
          >
            Exit impersonation
          </button>
        </div>
      )}
      {/* Universal top header */}
      <header className="shrink-0 z-10 flex items-center justify-between px-4 h-14 bg-[var(--color-sidebar-bg)] border-b border-[var(--color-sidebar-border)]">
        {/* Left: hamburger (mobile) + brand */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-1.5 rounded-lg text-[var(--color-sidebar-text)] hover:text-[var(--color-sidebar-text-strong)] hover:bg-[var(--color-sidebar-hover)] transition-colors"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <span className="text-base font-bold text-[var(--color-sidebar-text-strong)] tracking-tight">
            Kauf<span className="text-[var(--color-primary-hover)]">Nest</span>
          </span>
        </div>

        {/* Right: theme toggle + user menu */}
        <div className="flex items-center gap-1">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="p-1.5 rounded-lg text-[var(--color-sidebar-text)] hover:text-[var(--color-sidebar-text-strong)] hover:bg-[var(--color-sidebar-hover)] transition-colors cursor-pointer"
          >
            {theme === "dark" ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
          </button>

          {/* User menu */}
          <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen((o) => !o)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-btn)] text-[var(--color-sidebar-text)] hover:text-[var(--color-sidebar-text-strong)] hover:bg-[var(--color-sidebar-hover)] transition-colors cursor-pointer"
          >
            <div className="w-7 h-7 rounded-full bg-[var(--color-sidebar-hover)] flex items-center justify-center shrink-0">
              <User size={14} className="text-[var(--color-primary-hover)]" />
            </div>
            <span className="hidden sm:block text-sm font-medium text-[var(--color-sidebar-text-strong)] max-w-[140px] truncate leading-none">
              {displayName}
            </span>
            <ChevronDown
              size={14}
              className={`hidden sm:block shrink-0 transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`}
            />
          </button>

          {/* Dropdown */}
          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-[var(--radius-card)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl z-50 overflow-hidden">
              {/* User identity block */}
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[var(--color-surface-subtle)] flex items-center justify-center shrink-0 border border-[var(--color-border)]">
                    <User size={16} className="text-[var(--color-primary)]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-text-strong)] truncate">{displayName}</p>
                    <p className="text-xs text-[var(--color-text-faint)] truncate">{email}</p>
                    <span className="inline-block mt-0.5 px-1.5 py-px rounded text-[10px] font-medium bg-[var(--color-primary-muted)] text-[var(--color-primary-text)]">
                      {role.replace("_", " ")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="p-1.5">
                <button
                  onClick={() => { setUserMenuOpen(false); handleSignOut(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-btn)] text-sm text-[var(--color-text-base)] hover:text-red-500 hover:bg-[var(--color-surface-subtle)] transition-colors cursor-pointer"
                >
                  <LogOut size={15} strokeWidth={1.75} />
                  Sign out
                </button>
              </div>
            </div>
          )}
          </div>
        </div>
      </header>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          role={role}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <main className="flex-1 overflow-y-auto p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
