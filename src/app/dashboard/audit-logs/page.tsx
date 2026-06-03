import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { ActionBadge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils/date";
import type { AuditLog } from "@/types";

export default async function AuditLogsPage() {
  const supabase = await createClient();

  const { data: logs } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<AuditLog[]>();

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="Full history of all user actions in the system"
      />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {["Timestamp", "User", "Action", "Entity", "Details"].map((h) => (
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
            {(logs ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                  No audit logs yet.
                </td>
              </tr>
            ) : (
              (logs ?? []).map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap font-mono">
                    {formatDateTime(log.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {log.user_email ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <ActionBadge action={log.action} />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 capitalize">
                    {log.entity_type}
                    {log.entity_id && (
                      <span className="ml-1 text-xs text-slate-400 font-mono">
                        #{log.entity_id.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 font-mono max-w-xs truncate">
                    {log.metadata ? JSON.stringify(log.metadata) : "—"}
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
