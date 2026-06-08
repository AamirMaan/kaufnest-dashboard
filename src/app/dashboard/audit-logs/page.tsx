"use client";

import { useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable } from "@/components/ui/DataTable";
import { ActionBadge } from "@/components/ui/Badge";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AuditLogDetailModal } from "./_components/AuditLogDetailModal";
import { formatDateTime } from "@/lib/utils/date";
import type { AuditLog } from "@/types";

export default function AuditLogsPage() {
  const logs = useAppSelector((s) => s.auditLogs.items);
  const [viewTarget, setViewTarget] = useState<AuditLog | null>(null);

  const columns = [
    {
      header: "Timestamp",
      render: (log: AuditLog) => (
        <span className="text-xs font-mono text-[var(--color-text-muted)] whitespace-nowrap">
          {formatDateTime(log.created_at)}
        </span>
      ),
    },
    {
      header: "User",
      render: (log: AuditLog) => (
        <span className="text-sm text-[var(--color-text-base)]">{log.user_email ?? "—"}</span>
      ),
    },
    {
      header: "Action",
      render: (log: AuditLog) => <ActionBadge action={log.action} />,
    },
    {
      header: "Entity",
      render: (log: AuditLog) => (
        <span className="text-sm text-[var(--color-text-base)] capitalize">
          {log.entity_type}
          {log.entity_id && (
            <span className="ml-1 text-xs text-[var(--color-text-faint)] font-mono">
              #{log.entity_id.slice(0, 8)}
            </span>
          )}
        </span>
      ),
    },
    {
      header: "View",
      render: (log: AuditLog) => (
        <Button size="icon" variant="ghost" onClick={() => setViewTarget(log)} title="View details">
          <Eye size={15} />
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="Full history of all user actions in the system"
      />
      <DataTable
        columns={columns}
        rows={logs}
        keyField="id"
        emptyMessage="No audit logs yet."
      />
      <AuditLogDetailModal log={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
