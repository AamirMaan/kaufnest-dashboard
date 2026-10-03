"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateUserRole, updateUser } from "./_store/usersSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { Badge, RoleBadge, StatusBadge } from "@/components/ui/Badge";
import { InviteUserModal } from "./_components/InviteUserModal";
import { EditUserModal } from "./_components/EditUserModal";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { canDeactivateUser } from "./_lib/userStatusGuards";
import { exceptionsToGrid, customSections } from "./_lib/accessDiff";
import { Pencil, RefreshCw, ShieldCheck, UserX, UserCheck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { fetchAllRows } from "@/lib/utils/fetchAllRows";
import { formatDateTime } from "@/lib/utils/date";
import { SECTION_KEYS, type AccessLevel, type Section } from "@/lib/permissions/sections";
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
  const currentUserId = useAppSelector((s) => s.currentUser.profile?.id);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Profile | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Profile | null>(null);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);
  const [reactivating, setReactivating] = useState<string | null>(null);
  const [customAccessIds, setCustomAccessIds] = useState<Set<string>>(new Set());

  // Which users have a per-user section-access exception (shown as a "Custom
  // access" badge in the Role column). Bounded: at most 12 rows per user (one
  // per section) × users.length — never a growth-unbounded read, but that
  // product can still exceed PostgREST's Max Rows (silent truncation), so
  // it is paged with fetchAllRows.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = await createTenantClient();
      type Row = { user_id: string; section: Section; level: AccessLevel };
      const data = await fetchAllRows<Row>(
        async (from, to) =>
          await supabase
            .from("user_section_access")
            .select("user_id, section, level", { count: "exact" })
            .order("user_id", { ascending: true })
            .order("section", { ascending: true })
            .range(from, to)
            .returns<Row[]>(),
        Math.max(users.length, 1) * SECTION_KEYS.length
      );

      if (cancelled) return;

      const rowsByUser = new Map<string, { section: Section; level: AccessLevel }[]>();
      for (const row of data) {
        const list = rowsByUser.get(row.user_id) ?? [];
        list.push({ section: row.section, level: row.level });
        rowsByUser.set(row.user_id, list);
      }

      const custom = new Set<string>();
      for (const u of users) {
        const rows = rowsByUser.get(u.id);
        if (!rows || rows.length === 0) continue;
        const grid = exceptionsToGrid(u.role, rows);
        if (customSections(u.role, grid).length > 0) custom.add(u.id);
      }
      setCustomAccessIds(custom);
    })();

    return () => {
      cancelled = true;
    };
  }, [users]);

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

  async function writeStatusChange(
    profile: Profile,
    newStatus: Profile["status"],
    reason?: string
  ) {
    const supabase = await createTenantClient();
    const { data, error } = await supabase
      .from("profiles")
      .update({ status: newStatus })
      .eq("id", profile.id)
      .select()
      .single<Profile>();

    if (error) {
      toastError(
        newStatus === "deactivated" ? "Deactivation failed" : "Reactivation failed",
        error.message
      );
      return;
    }

    dispatch(updateUser(data));

    const { data: { user: caller } } = await supabase.auth.getUser();
    const log = await writeAuditLog(supabase, {
      userId: caller!.id,
      userEmail: caller!.email ?? "",
      action: "status_change",
      entityType: "user",
      entityId: profile.id,
      metadata: {
        from: profile.status,
        to: newStatus,
        target_email: profile.email,
        ...(reason ? { reason } : {}),
      },
    });
    if (log) dispatch(addAuditLog(log));
  }

  async function handleDeactivate(reason: string) {
    if (!deactivateTarget) return;
    await writeStatusChange(deactivateTarget, "deactivated", reason);
    success("User deactivated", `${deactivateTarget.email} no longer has dashboard access.`);
    setDeactivateTarget(null);
  }

  async function handleReactivate(profile: Profile) {
    setReactivating(profile.id);
    await writeStatusChange(profile, "active");
    success("User reactivated", `${profile.email} can access the dashboard again.`);
    setReactivating(null);
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
      render: (p: Profile) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <RoleBadge role={p.role} />
          {customAccessIds.has(p.id) && <Badge label="Custom access" variant="info" />}
        </div>
      ),
    },
    {
      header: "Status",
      render: (p: Profile) => <StatusBadge status={p.status} />,
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
      render: (p: Profile) => {
        const deactivateGuard = canDeactivateUser(p, currentUserId ?? "", users);
        return (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={() => setEditTarget(p)} title="Edit user">
              <Pencil size={15} className="text-blue-500" />
            </Button>
            {p.role !== "super_admin" && (
              <Link
                href={`/dashboard/users/${p.id}/permissions`}
                title="Manage permissions"
                className="inline-flex items-center justify-center gap-1.5 rounded-(--radius-btn) p-1.5 text-xs font-semibold transition-colors cursor-pointer text-(--color-text-muted) hover:text-(--color-text-base) hover:bg-(--color-surface-subtle)"
              >
                <ShieldCheck size={15} className="text-emerald-500" />
              </Link>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => handleResendInvite(p)}
              disabled={resendingInvite === p.id}
              title="Resend invite"
            >
              <RefreshCw size={15} className={resendingInvite === p.id ? "animate-spin text-[var(--color-text-muted)]" : "text-teal-500"} />
            </Button>
            {p.status === "active" ? (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setDeactivateTarget(p)}
                disabled={!deactivateGuard.allowed}
                title={deactivateGuard.allowed ? "Deactivate user" : deactivateGuard.reason}
              >
                <UserX size={15} className={deactivateGuard.allowed ? "text-red-500" : "text-[var(--color-text-faint)]"} />
              </Button>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => handleReactivate(p)}
                disabled={reactivating === p.id}
                title="Reactivate user"
              >
                <UserCheck size={15} className={reactivating === p.id ? "animate-spin text-[var(--color-text-muted)]" : "text-emerald-500"} />
              </Button>
            )}
          </div>
        );
      },
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
      <DeleteConfirmModal
        open={!!deactivateTarget}
        title="Deactivate User"
        description={
          deactivateTarget
            ? `${deactivateTarget.full_name || deactivateTarget.email} will immediately lose dashboard access. Their existing records (sales, expenses, purchases, etc.) are not affected — this does not delete their account.`
            : ""
        }
        confirmLabel="Deactivate"
        confirmingLabel="Deactivating…"
        reasonLabel="Reason for Deactivation"
        reasonPlaceholder="Briefly explain why this user is being deactivated…"
        onConfirm={handleDeactivate}
        onClose={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
