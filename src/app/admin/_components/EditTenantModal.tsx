"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import type { Tenant, TenantPlan, TenantStatus } from "@/types";

interface Props {
  open: boolean;
  tenant: Tenant;
  onClose: () => void;
}

const labelCls =
  "block text-[11px] font-medium uppercase tracking-wider text-(--color-text-faint) mb-1";
const selectCls =
  "w-full rounded-[var(--radius-btn)] border border-(--color-border) bg-(--color-surface) px-2.5 py-2 text-sm text-(--color-text-strong) focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";

export function EditTenantModal({ open, tenant, onClose }: Props) {
  const toast = useToast();
  const [plan, setPlan] = useState<TenantPlan>(tenant.plan);
  const [status, setStatus] = useState<TenantStatus>(tenant.status);
  const [adminEmail, setAdminEmail] = useState(tenant.admin_email ?? "");
  const [aiEnabled, setAiEnabled] = useState(tenant.ai_enabled);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailChanged = adminEmail !== (tenant.admin_email ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const patch: {
      plan?: TenantPlan;
      status?: TenantStatus;
      admin_email?: string;
      ai_enabled?: boolean;
    } = {};
    if (plan !== tenant.plan) patch.plan = plan;
    if (status !== tenant.status) patch.status = status;
    if (emailChanged) patch.admin_email = adminEmail;
    if (aiEnabled !== tenant.ai_enabled) patch.ai_enabled = aiEnabled;

    // Nothing changed — close without a network call
    if (Object.keys(patch).length === 0) {
      setLoading(false);
      onClose();
      return;
    }

    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      const data = (await res.json()) as {
        tenant?: Tenant;
        error?: string;
        detail?: string;
      };

      if (!res.ok) {
        const message = data.detail ?? data.error ?? "Update failed";
        setError(message);
        toast.error("Failed to update tenant", message);
        return;
      }

      toast.success("Tenant updated", `${tenant.name} has been updated.`);
      onClose();
    } catch {
      const message = "Network error — please try again";
      setError(message);
      toast.error("Failed to update tenant", message);
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setPlan(tenant.plan);
    setStatus(tenant.status);
    setAdminEmail(tenant.admin_email ?? "");
    setAiEnabled(tenant.ai_enabled);
    setError(null);
    onClose();
  }

  return (
    <Modal
      title={`Edit ${tenant.name}`}
      open={open}
      onClose={handleClose}
      footer={
        <div className="flex items-center gap-2 justify-end">
          <Button variant="secondary" type="button" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" form="edit-tenant-form" disabled={loading}>
            {loading ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      }
    >
      <form id="edit-tenant-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-sm text-(--color-danger) bg-(--color-danger-bg) rounded-[var(--radius-btn)] px-3 py-2">
            {error}
          </p>
        )}

        <Field label="Admin Email" required>
          <Input
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder="admin@example.com"
            required
          />
          {emailChanged && (
            <p className="text-xs text-(--color-text-muted) mt-1">
              A verification email will be sent to the new address.
            </p>
          )}
        </Field>

        <div>
          <span className={labelCls}>Plan</span>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value as TenantPlan)}
            className={selectCls}
          >
            <option value="trial">Trial</option>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="business">Business</option>
          </select>
        </div>

        <div>
          <span className={labelCls}>Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TenantStatus)}
            className={selectCls}
          >
            <option value="active">Active</option>
            <option value="invited">Invited</option>
            <option value="deactivated">Deactivated</option>
          </select>
        </div>

        <Checkbox
          label="AI features visible to this tenant"
          checked={aiEnabled}
          onChange={(e) => setAiEnabled(e.target.checked)}
        />
      </form>
    </Modal>
  );
}
