"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/FormFields";
import { useAppDispatch } from "@/store/hooks";
import { updateUser } from "../_store/usersSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import type { Profile, UserRole } from "@/types";

const ROLES: { value: UserRole; label: string }[] = [
  { value: "accountant", label: "Accountant" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
];

interface Props {
  user: Profile | null;
  onClose: () => void;
}

interface FormState {
  full_name: string;
  role: UserRole;
}

export function EditUserModal({ user, onClose }: Props) {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState<FormState>(() =>
    user ? { full_name: user.full_name ?? "", role: user.role } : { full_name: "", role: "accountant" }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!form.full_name.trim()) return setError("Full name is required.");
    setError(null);
    setSaving(true);

    const supabase = await createTenantClient();
    const { data, error: dbError } = await supabase
      .from("profiles")
      .update({ full_name: form.full_name.trim(), role: form.role })
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
      action: "update",
      entityType: "user",
      entityId: user.id,
      metadata: {
        before: { full_name: user.full_name, role: user.role },
        after:  { full_name: data.full_name, role: data.role },
        target_email: user.email,
      },
    });
    if (log) dispatch(addAuditLog(log));

    setSaving(false);
    onClose();
  }

  return (
    <Modal
      title="Edit User"
      open={!!user}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="edit-user-form" disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </>
      }
    >
      <form id="edit-user-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        <Field label="Email">
          <Input value={user?.email ?? ""} disabled />
        </Field>

        <Field label="Full Name" required>
          <Input
            value={form.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            required
          />
        </Field>

        <Field label="Role" required>
          <Select value={form.role} onChange={(e) => set("role", e.target.value as UserRole)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}
