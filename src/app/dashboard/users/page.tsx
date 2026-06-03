import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { RoleBadge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils/date";
import type { Profile } from "@/types";

export default async function UsersPage() {
  const supabase = await createClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true })
    .returns<Profile[]>();

  return (
    <div>
      <PageHeader
        title="Users"
        description="Manage team members and their roles"
      />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {["Name", "Email", "Role", "Joined"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(profiles ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                  No users found.
                </td>
              </tr>
            ) : (
              (profiles ?? []).map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {p.full_name || "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{p.email}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={p.role} />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {formatDateTime(p.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
