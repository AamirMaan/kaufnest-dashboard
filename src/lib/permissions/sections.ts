/**
 * Section permissions — the TypeScript mirror of migration 055's
 * role_section_default / section_level_allowed. Pure and client-safe.
 * The database is the enforcement; this drives the UI, proxy.ts and
 * server guards. Parity with SQL is checked by
 * sectionPermissions.integration.test.ts.
 */
import type { TenantPlan, UserRole } from "@/types";
import { hasMessagingAndListings, hasPlatformIntegrations } from "@/lib/utils/planGating";

export type Section =
  | "overview" | "analytics" | "orders" | "expenses" | "purchases" | "inventory"
  | "payouts" | "integrations" | "listings" | "messages" | "audit_logs" | "settings";
export type AccessLevel = 0 | 1 | 2 | 3;
export type AccessMap = Record<Section, AccessLevel>;

export const LEVEL_LABELS: Record<AccessLevel, string> = { 0: "None", 1: "View", 2: "Edit", 3: "Delete" };

export interface SectionDef {
  key: Section;
  label: string;
  levels: AccessLevel[];
  /** Route prefixes (longest match wins); empty for action-only sections. */
  routes: string[];
  description: string;
}

export const SECTIONS: SectionDef[] = [
  { key: "overview", label: "Overview", levels: [0, 1], routes: ["/dashboard"], description: "Home totals and platform cards" },
  { key: "analytics", label: "Analytics", levels: [0, 1], routes: ["/dashboard/analytics"], description: "Charts" },
  { key: "orders", label: "Orders", levels: [0, 1, 2, 3], routes: ["/dashboard/sales"], description: "Orders and shipping labels" },
  { key: "expenses", label: "Expenses", levels: [0, 1, 2, 3], routes: ["/dashboard/expenses"], description: "Expense records" },
  { key: "purchases", label: "Purchases", levels: [0, 1, 2, 3], routes: ["/dashboard/purchases"], description: "Inventory purchases" },
  { key: "inventory", label: "Inventory", levels: [0, 1, 2, 3], routes: ["/dashboard/inventory"], description: "Products, stock, locations, transfers" },
  { key: "payouts", label: "Payouts", levels: [0, 1, 2, 3], routes: [], description: "Recorded eBay/Amazon transfers" },
  { key: "integrations", label: "Integrations", levels: [0, 2], routes: ["/dashboard/integrations"], description: "eBay/Amazon connections, Review Orders" },
  { key: "listings", label: "Listings", levels: [0, 2], routes: ["/dashboard/listings"], description: "eBay listings" },
  { key: "messages", label: "Messages", levels: [0, 2], routes: ["/dashboard/messages"], description: "eBay buyer messages" },
  { key: "audit_logs", label: "Audit logs", levels: [0, 1], routes: ["/dashboard/audit-logs"], description: "Activity trail" },
  { key: "settings", label: "Settings", levels: [0, 1, 2], routes: ["/dashboard/settings"], description: "Company profile, invoices, billing" },
];

export const SECTION_KEYS: Section[] = SECTIONS.map((s) => s.key);

export function maxLevel(section: Section): AccessLevel {
  const levels = SECTIONS.find((s) => s.key === section)!.levels;
  return levels[levels.length - 1];
}

const maxMap = (): AccessMap =>
  Object.fromEntries(SECTION_KEYS.map((k) => [k, maxLevel(k)])) as AccessMap;

export const ROLE_DEFAULTS: Record<UserRole, AccessMap> = {
  super_admin: maxMap(),
  admin: maxMap(),
  accountant: {
    overview: 1, analytics: 1, orders: 2, expenses: 2, purchases: 2, inventory: 2,
    payouts: 1, integrations: 0, listings: 0, messages: 0, audit_logs: 0, settings: 1,
  },
};

export function planAllows(section: Section, plan: TenantPlan | null): boolean {
  if (!plan) return !["integrations", "listings", "messages"].includes(section);
  if (section === "integrations") return hasPlatformIntegrations(plan);
  if (section === "listings" || section === "messages") return hasMessagingAndListings(plan);
  return true;
}

export function applyPlanCeiling(access: AccessMap, plan: TenantPlan | null): AccessMap {
  return Object.fromEntries(
    SECTION_KEYS.map((k) => [k, planAllows(k, plan) ? access[k] : 0])
  ) as AccessMap;
}

const isAllowed = (section: Section, v: unknown): v is AccessLevel =>
  typeof v === "number" && (SECTIONS.find((s) => s.key === section)!.levels as number[]).includes(v);

export function effectiveAccess(role: UserRole, exceptions: Partial<AccessMap>, plan: TenantPlan | null): AccessMap {
  const base = ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.accountant;
  const merged = Object.fromEntries(
    SECTION_KEYS.map((k) => {
      if (role === "super_admin") return [k, base[k]];
      const e = exceptions[k];
      return [k, isAllowed(k, e) ? e : base[k]];
    })
  ) as AccessMap;
  return applyPlanCeiling(merged, plan);
}

/** Validate get_my_access() JSON; any missing/invalid key falls back to the role default. */
export function parseAccessMap(raw: unknown, fallbackRole: UserRole): AccessMap {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const base = ROLE_DEFAULTS[fallbackRole] ?? ROLE_DEFAULTS.accountant;
  return Object.fromEntries(
    SECTION_KEYS.map((k) => [k, isAllowed(k, obj[k]) ? obj[k] : base[k]])
  ) as AccessMap;
}

export function sectionForPath(pathname: string): Section | "users" | null {
  if (pathname.startsWith("/dashboard/users")) return "users";
  let best: { key: Section; len: number } | null = null;
  for (const s of SECTIONS) {
    for (const r of s.routes) {
      const hit = r === "/dashboard" ? pathname === "/dashboard" : pathname === r || pathname.startsWith(`${r}/`);
      if (hit && (!best || r.length > best.len)) best = { key: s.key, len: r.length };
    }
  }
  return best?.key ?? null;
}

export function can(access: AccessMap, section: Section, min: AccessLevel): boolean {
  return access[section] >= min;
}

/**
 * Whether a section should be *reachable* (nav link, route) — evaluated
 * against the UNCAPPED access map (role defaults + per-user exceptions,
 * before the plan ceiling), so a user whose role/exception grants a
 * plan-gated section (Integrations/Listings/Messages) still sees the nav
 * entry and can navigate there; the page itself shows its upgrade screen
 * when the plan doesn't include the feature. Button-level actions use
 * `can()` against the plan-capped map instead — see `useAccess()`.
 */
export function canSeeSection(uncapped: AccessMap, section: Section): boolean {
  return can(uncapped, section, 1);
}

export function firstAccessiblePath(access: AccessMap): string {
  const s = SECTIONS.find((d) => d.routes.length > 0 && access[d.key] >= 1);
  return s ? s.routes[0] : "/dashboard/support";
}

/**
 * Where to send a request denied access to `section`, or null if no
 * redirect is needed (section is allowed, or the computed destination is
 * where the request already is — the loop guard).
 *
 * `section === "overview"` means Home itself is hidden: that's not a denial
 * of the page the user asked for, so no `denied` param is added — an
 * incoming one (`deniedParam`, e.g. from a prior hop) is preserved instead
 * of being dropped. Any other denied section redirects to Home (if visible)
 * or the first accessible page, carrying `?denied=<section>` so the caller
 * can toast it — one hop, since the destination is chosen to already be
 * accessible.
 */
export function deniedRedirect(
  pathname: string,
  section: Section,
  access: AccessMap,
  deniedParam?: Section | null,
): string | null {
  if (can(access, section, 1)) return null;

  if (section === "overview") {
    const dest = firstAccessiblePath(access);
    if (dest === pathname) return null;
    return deniedParam ? `${dest}?denied=${deniedParam}` : dest;
  }

  const dest = can(access, "overview", 1) ? "/dashboard" : firstAccessiblePath(access);
  if (dest === pathname) return null;
  return `${dest}?denied=${section}`;
}
