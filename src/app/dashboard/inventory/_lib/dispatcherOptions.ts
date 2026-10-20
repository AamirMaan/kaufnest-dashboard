import { ROLE_DEFAULTS } from "@/lib/permissions/sections";
import type { Profile } from "@/types";

/**
 * Users who may be a location's dispatcher (057): active, and whose role
 * default can view Orders. Per-user section exceptions are server-side and
 * not loaded here — a dispatcher whose exception removes Orders just sees an
 * empty banner (my_dispatch_queue checks effective Orders access). The current
 * dispatcher is always kept so editing a location never silently drops it:
 * labelled "(deactivated)" / "(no Orders access)" when ineligible, or
 * "Current dispatcher" when not in `users` at all (non-admins only see their
 * own profile under RLS) so the Select never misleadingly reads "None".
 */
export function dispatcherOptions(users: Profile[], currentId: string | null) {
  const label = (u: Profile) => u.full_name?.trim() || u.email;
  const canViewOrders = (u: Profile) => (ROLE_DEFAULTS[u.role]?.orders ?? 0) >= 1;
  const eligible = users.filter((u) => u.status === "active" && canViewOrders(u));
  const opts = eligible.map((u) => ({ value: u.id, label: label(u) }));
  if (currentId && !eligible.some((u) => u.id === currentId)) {
    const cur = users.find((u) => u.id === currentId);
    if (!cur) opts.push({ value: currentId, label: "Current dispatcher" });
    else if (cur.status !== "active") opts.push({ value: cur.id, label: `${label(cur)} (deactivated)` });
    else opts.push({ value: cur.id, label: `${label(cur)} (no Orders access)` });
  }
  return opts.sort((a, b) => a.label.localeCompare(b.label));
}

export function dispatcherName(users: Profile[], id: string | null): string | null {
  if (!id) return null;
  const u = users.find((x) => x.id === id);
  return u ? u.full_name?.trim() || u.email : null;
}
