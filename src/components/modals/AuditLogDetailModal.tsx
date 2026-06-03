"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ActionBadge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils/date";
import type { AuditLog } from "@/types";

interface Props {
  log: AuditLog | null;
  onClose: () => void;
}

function KVTable({ title, data }: { title: string; data: Record<string, unknown> }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">
        {title}
      </h4>
      <div className="rounded-[var(--radius-btn)] bg-[var(--color-surface-subtle)] border border-[var(--color-border)] divide-y divide-[var(--color-border-subtle)]">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex gap-3 px-3 py-2 text-sm">
            <span className="font-mono text-[var(--color-text-muted)] w-36 flex-shrink-0">{key}</span>
            <span className="text-[var(--color-text-base)] break-all">
              {value === null || value === undefined
                ? <span className="text-[var(--color-text-faint)] italic">—</span>
                : typeof value === "object"
                ? <span className="font-mono text-xs">{JSON.stringify(value)}</span>
                : String(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AuditLogDetailModal({ log, onClose }: Props) {
  if (!log) return null;

  const meta = log.metadata ?? {};
  const before = meta.before as Record<string, unknown> | undefined;
  const after  = meta.after  as Record<string, unknown> | undefined;
  const reason = meta.reason as string | undefined;
  const simpleKeys = Object.keys(meta).filter((k) => !["before", "after", "reason"].includes(k));

  return (
    <Modal
      title="Audit Log Details"
      open={!!log}
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-5">
        {/* Summary grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <span className="text-xs font-medium text-[var(--color-text-faint)] uppercase tracking-wider">Timestamp</span>
            <p className="mt-0.5 font-mono text-xs text-[var(--color-text-base)]">{formatDateTime(log.created_at)}</p>
          </div>
          <div>
            <span className="text-xs font-medium text-[var(--color-text-faint)] uppercase tracking-wider">User</span>
            <p className="mt-0.5 text-[var(--color-text-base)] truncate">{log.user_email ?? "—"}</p>
          </div>
          <div>
            <span className="text-xs font-medium text-[var(--color-text-faint)] uppercase tracking-wider">Action</span>
            <div className="mt-1"><ActionBadge action={log.action} /></div>
          </div>
          <div>
            <span className="text-xs font-medium text-[var(--color-text-faint)] uppercase tracking-wider">Entity</span>
            <p className="mt-0.5 text-[var(--color-text-base)] capitalize">
              {log.entity_type}
              {log.entity_id && (
                <span className="ml-1 text-xs font-mono text-[var(--color-text-faint)]">
                  #{log.entity_id.slice(0, 8)}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Reason banner */}
        {reason && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-info-bg)] border border-blue-100 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-info-text)]">Reason</span>
            <p className="mt-1 text-sm text-[var(--color-text-base)]">{reason}</p>
          </div>
        )}

        {/* Before / After for update/delete */}
        {before && <KVTable title="State Before" data={before} />}
        {after  && <KVTable title="State After"  data={after} />}

        {/* Simple details (create / login / role_change etc.) */}
        {simpleKeys.length > 0 && (
          <KVTable
            title={before || after ? "Additional Details" : "Details"}
            data={Object.fromEntries(simpleKeys.map((k) => [k, meta[k]]))}
          />
        )}

        {Object.keys(meta).length === 0 && (
          <p className="text-sm text-[var(--color-text-faint)] italic">No metadata available.</p>
        )}
      </div>
    </Modal>
  );
}
