"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/FormFields";
import { useAppDispatch } from "@/store/hooks";
import { addUser } from "../_store/usersSlice";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createClient } from "@/lib/supabase/client";
import type { UserRole, AuditLog } from "@/types";

const ROLES: { value: UserRole; label: string }[] = [
  { value: "accountant", label: "Accountant" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FormState {
  email: string;
  full_name: string;
  role: UserRole;
}

const defaults: FormState = { email: "", full_name: "", role: "accountant" };

export function InviteUserModal({ open, onClose }: Props) {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState<FormState>(defaults);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email.trim()) return setError("Email is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      return setError("Please enter a valid email address.");

    setError(null);
    setSaving(true);

    const res = await fetch("/api/users/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.email.trim(),
        full_name: form.full_name.trim(),
        role: form.role,
      }),
    });

    const json = await res.json() as { profile?: NonNullable<unknown>; error?: string };

    if (!res.ok) {
      setError(json.error ?? "Failed to invite user.");
      setSaving(false);
      return;
    }

    // Update local Redux store optimistically
    if (json.profile) {
      dispatch(addUser(json.profile as Parameters<typeof addUser>[0]));
    }

    // Append audit log entry to Redux (the server already wrote it to DB;
    // we build a local entry so the Audit Logs page reflects it immediately)
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const logEntry: AuditLog = {
      id: crypto.randomUUID(),
      user_id: user?.id ?? "",
      user_email: user?.email ?? null,
      action: "create",
      entity_type: "user",
      entity_id: (json.profile as { id?: string } | undefined)?.id ?? null,
      metadata: { invited_email: form.email.trim(), assigned_role: form.role },
      created_at: new Date().toISOString(),
    };
    dispatch(addAuditLog(logEntry));

    setSuccess(`Invitation sent to ${form.email.trim()}.`);
    setForm(defaults);
    setSaving(false);
  }

  function handleClose() {
    setForm(defaults);
    setError(null);
    setSuccess(null);
    onClose();
  }

  return (
    <Modal
      title="Invite User"
      open={open}
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose} disabled={saving}>
            {success ? "Close" : "Cancel"}
          </Button>
          {!success && (
            <Button type="submit" form="invite-user-form" disabled={saving}>
              {saving ? "Sending…" : "Send Invite"}
            </Button>
          )}
        </>
      }
    >
      <form id="invite-user-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-[var(--radius-btn)] bg-[var(--color-success-bg)] border border-green-200 px-4 py-3 text-sm text-[var(--color-success-text)]">
            {success} They will receive an email to set their password.
          </div>
        )}

        {!success && (
          <>
            <Field label="Email Address" required>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="user@example.com"
                required
              />
            </Field>

            <Field label="Full Name">
              <Input
                value={form.full_name}
                onChange={(e) => set("full_name", e.target.value)}
                placeholder="Jane Doe"
              />
            </Field>

            <Field label="Role" required>
              <Select
                value={form.role}
                onChange={(e) => set("role", e.target.value as UserRole)}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}
