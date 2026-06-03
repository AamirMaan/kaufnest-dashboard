"use client";

import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateUserRole } from "@/store/slices/usersSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { RoleBadge } from "@/components/ui/Badge";
import { InviteUserModal } from "@/components/modals/InviteUserModal";
import { createClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatDateTime } from "@/lib/utils/date";
import type { Profile, UserRole } from "@/types";

const ROLES: { value: UserRole; label: string }[] = [
  { value: "accountant", label: "Accountant" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
];

export default function UsersPage() {
  const dispatch = useAppDispatch();
  const users = useAppSelector((s) => s.users.items);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [changingRole, setChangingRole] = useState<string | null>(null);

  async function handleRoleChange(profile: Profile, newRole: UserRole) {
    if (newRole === profile.role) return;
    setChangingRole(profile.id);

    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ role: newRole })
      .eq("id", profile.id);

    if (!error) {
      dispatch(updateUserRole({ id: profile.id, role: newRole }));

      const { data: { user } } = await supabase.auth.getUser();
      const log = await writeAuditLog(supabase, {
        userId: user!.id,
        userEmail: user!.email ?? "",
        action: "role_change",
        entityType: "user",
        entityId: profile.id,
        metadata: { from: profile.role, to: newRole, target_email: profile.email },
      });
      if (log) dispatch(addAuditLog(log));
    }

    setChangingRole(null);
  }

  const columns = [
    {
      header: "Name",
      render: (p: Profile) => (
        <span className="text-sm font-medium text-[var(--color-text-strong)]">
          {p.full_name || "—"}
        </span>
      ),
    },
    {
      header: "Email",
      render: (p: Profile) => (
        <span className="text-sm text-[var(--color-text-base)]">{p.email}</span>
      ),
    },
    {
      header: "Role",
      render: (p: Profile) => <RoleBadge role={p.role} />,
    },
    {
      header: "Joined",
      render: (p: Profile) => (
        <span className="text-sm text-[var(--color-text-muted)]">
          {formatDateTime(p.created_at)}
        </span>
      ),
    },
    {
      header: "Change Role",
      render: (p: Profile) => (
        <select
          value={p.role}
          disabled={changingRole === p.id}
          onChange={(e) => handleRoleChange(p, e.target.value as UserRole)}
          className="text-sm rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text-base)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Users"
        description="Manage team members and their roles"
        action={
          <Button onClick={() => setInviteOpen(true)}>+ Invite User</Button>
        }
      />
      <DataTable
        columns={columns}
        rows={users}
        keyField="id"
        emptyMessage="No users found."
      />
      <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
