"use client";

import { Modal } from "@/components/ui/Modal";
import type { Tenant } from "@/types";

interface Props {
  open: boolean;
  tenant: Tenant;
  used: number;
  limit: number;
  byUser: Record<string, number>;
  onClose: () => void;
}

export function AiUsageModal({ open, tenant, used, limit, byUser, onClose }: Props) {
  const rows = Object.entries(byUser).sort(([, a], [, b]) => b - a);

  return (
    <Modal open={open} onClose={onClose} title={`AI Usage — ${tenant.name}`}>
      <div className="space-y-4">
        <p className="text-sm font-semibold text-[var(--color-text-strong)]">
          {used} of {limit} generations this month
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No AI usage this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-faint)] pb-2 pr-4">
                    User
                  </th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-faint)] pb-2">
                    Calls
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {rows.map(([userId, calls]) => (
                  <tr key={userId}>
                    <td className="py-2 pr-4 font-mono text-xs text-[var(--color-text-muted)] truncate max-w-[220px]">
                      {userId}
                    </td>
                    <td className="py-2 text-[var(--color-text-strong)]">{calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
