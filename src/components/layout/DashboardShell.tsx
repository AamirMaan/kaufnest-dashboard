"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Menu, User, LogOut, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
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

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--color-surface-subtle)]">
      {/* Universal top header */}
      <header className="shrink-0 z-10 flex items-center justify-between px-4 h-14 bg-[var(--color-sidebar-bg)] border-b border-[var(--color-sidebar-border)]">
        {/* Left: hamburger (mobile) + brand */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <span className="text-base font-bold text-white tracking-tight">
            Kauf<span className="text-[var(--color-primary-hover)]">Nest</span>
          </span>
        </div>

        {/* Right: user menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen((o) => !o)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-btn)] text-[var(--color-sidebar-text)] hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <div className="w-7 h-7 rounded-full bg-[var(--color-sidebar-border)] flex items-center justify-center shrink-0">
              <User size={14} className="text-[var(--color-primary-hover)]" />
            </div>
            <span className="hidden sm:block text-sm font-medium text-white max-w-[140px] truncate leading-none">
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
                  <div className="w-9 h-9 rounded-full bg-[var(--color-sidebar-border)] flex items-center justify-center shrink-0">
                    <User size={16} className="text-[var(--color-primary-hover)]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-text-strong)] truncate">{displayName}</p>
                    <p className="text-xs text-[var(--color-text-faint)] truncate">{email}</p>
                    <span className="inline-block mt-0.5 px-1.5 py-px rounded text-[10px] font-medium bg-[var(--color-sidebar-border)] text-[var(--color-primary-hover)]">
                      {role.replace("_", " ")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="p-1.5">
                <button
                  onClick={() => { setUserMenuOpen(false); handleSignOut(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-btn)] text-sm text-[var(--color-text-base)] hover:text-red-400 hover:bg-[var(--color-surface-subtle)] transition-colors cursor-pointer"
                >
                  <LogOut size={15} strokeWidth={1.75} />
                  Sign out
                </button>
              </div>
            </div>
          )}
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
          fullName={fullName}
          email={email}
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
