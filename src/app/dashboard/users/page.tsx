"use client";

import { useAppSelector } from "@/store/hooks";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable } from "@/components/ui/DataTable";
import { RoleBadge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils/date";
import type { Profile } from "@/types";

export default function UsersPage() {
  const users = useAppSelector((s) => s.users.items);

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
  ];

  return (
    <div>
      <PageHeader
        title="Users"
        description="Manage team members and their roles"
      />
      <DataTable
        columns={columns}
        rows={users}
        keyField="id"
        emptyMessage="No users found."
      />
    </div>
  );
}
