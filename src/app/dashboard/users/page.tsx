"use client";

import { useState, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateUserRole } from "./_store/usersSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { RoleBadge } from "@/components/ui/Badge";
import { InviteUserModal } from "./_components/InviteUserModal";
import { EditUserModal } from "./_components/EditUserModal";
import { PermissionsModal } from "./_components/PermissionsModal";
import { Pencil, RefreshCw, ShieldCheck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { formatDateTime } from "@/lib/utils/date";
import type { Profile, UserRole } from "@/types";

const DEFAULT_PAGE_SIZE = 25;

const ROLES: { value: UserRole; label: string }[] = [
  { value: "accountant", label: "Accountant" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
];

export default function UsersPage() {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const users = useAppSelector((s) => s.users.items);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Profile | null>(null);
  const [permissionsTarget, setPermissionsTarget] = useState<Profile | null>(null);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);

  const pagedUsers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return users.slice(start, start + pageSize);
  }, [users, page, pageSize]);

  async function handleResendInvite(profile: Profile) {
    setResendingInvite(profile.id);
    try {
      const res = await fetch("/api/users/resend-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: profile.email }),
      });
      if (res.ok) {
        success("Invite resent", `A new invite link was sent to ${profile.email}.`);
      } else {
        const { error } = await res.json();
        toastError("Resend failed", error ?? "Could not resend invite.");
      }
    } finally {
      setResendingInvite(null);
    }
  }

  async function handleRoleChange(profile: Profile, newRole: UserRole) {
    if (newRole === profile.role) return;
    setChangingRole(profile.id);

    const supabase = await createTenantClient();
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
    {
      header: "Actions",
      render: (p: Profile) => (
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setEditTarget(p)} title="Edit user">
            <Pencil size={15} className="text-blue-500" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setPermissionsTarget(p)}
            title="Manage permissions"
          >
            <ShieldCheck size={15} className="text-emerald-500" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => handleResendInvite(p)}
            disabled={resendingInvite === p.id}
            title="Resend invite"
          >
            <RefreshCw size={15} className={resendingInvite === p.id ? "animate-spin text-[var(--color-text-muted)]" : "text-teal-500"} />
          </Button>
        </div>
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
        rows={pagedUsers}
        keyField="id"
        emptyMessage="No users found."
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={users.length}
        onPageChange={(p) => setPage(p)}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />
      <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <EditUserModal key={editTarget?.id ?? "edit-user"} user={editTarget} onClose={() => setEditTarget(null)} />
      <PermissionsModal
        key={permissionsTarget?.id ?? "permissions"}
        user={permissionsTarget}
        onClose={() => setPermissionsTarget(null)}
      />
    </div>
  );
}
