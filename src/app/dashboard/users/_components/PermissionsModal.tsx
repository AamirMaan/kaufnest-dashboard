"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/FormFields";
import { useAppDispatch } from "@/store/hooks";
import { updateUser } from "../_store/usersSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { hasPermission, PERMISSION_LABELS, type Permission } from "@/lib/utils/permissions";
import type { Profile } from "@/types";

interface Props {
  user: Profile | null;
  onClose: () => void;
}

const PERMISSION_GROUPS: { title: string; permissions: Permission[] }[] = [
  {
    title: "Orders",
    permissions: ["create_sale", "update_sale", "delete_sale"],
  },
  {
    title: "Expenses",
    permissions: ["create_expense", "update_expense", "delete_expense"],
  },
  {
    title: "Purchases",
    permissions: ["create_purchase", "update_purchase", "delete_purchase"],
  },
  {
    title: "Users",
    permissions: ["manage_users", "invite_user", "change_user_role"],
  },
  {
    title: "Reporting",
    permissions: ["view_audit_logs", "view_analytics"],
  },
  {
    title: "Platform integrations",
    permissions: ["manage_integrations", "manage_listings"],
  },
];

export function PermissionsModal({ user, onClose }: Props) {
  const dispatch = useAppDispatch();
  const [selected, setSelected] = useState<Set<Permission>>(
    () => new Set((user?.permission_overrides ?? []) as Permission[])
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(permission: Permission) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  async function handleSave() {
    if (!user) return;
    setError(null);
    setSaving(true);

    const nextOverrides = Array.from(selected);
    const supabase = await createTenantClient();
    const { data, error: dbError } = await supabase
      .from("profiles")
      .update({ permission_overrides: nextOverrides })
      .eq("id", user.id)
      .select()
      .single<Profile>();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    dispatch(updateUser(data));

    const { data: { user: caller } } = await supabase.auth.getUser();
    const log = await writeAuditLog(supabase, {
      userId: caller!.id,
      userEmail: caller!.email ?? "",
      action: "permission_change",
      entityType: "user",
      entityId: user.id,
      metadata: {
        before: user.permission_overrides ?? [],
        after: nextOverrides,
        target_email: user.email,
      },
    });
    if (log) dispatch(addAuditLog(log));

    setSaving(false);
    onClose();
  }

  return (
    <Modal
      title={user ? `Permissions — ${user.full_name || user.email}` : "Permissions"}
      open={!!user}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <p className="text-sm text-[var(--color-text-muted)]">
          Grant this user extra permissions on top of what their{" "}
          <span className="font-medium">{user?.role.replace("_", " ")}</span> role already
          includes. Permissions can only be added here, never taken away from the role.
        </p>

        {user &&
          PERMISSION_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {group.title}
              </h3>
              <div className="space-y-1.5 rounded-[var(--radius-card)] border border-[var(--color-border)] p-3">
                {group.permissions.map((permission) => {
                  const includedByRole = hasPermission(user.role, permission);
                  return (
                    <Checkbox
                      key={permission}
                      label={
                        includedByRole
                          ? `${PERMISSION_LABELS[permission]} (included in ${user.role.replace("_", " ")} role)`
                          : PERMISSION_LABELS[permission]
                      }
                      checked={includedByRole || selected.has(permission)}
                      disabled={includedByRole}
                      onChange={() => toggle(permission)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
      </div>
    </Modal>
  );
}
