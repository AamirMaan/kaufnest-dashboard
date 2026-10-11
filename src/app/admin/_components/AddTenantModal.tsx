"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { usePlanOptions } from "./usePlanOptions";

interface Props {
  open: boolean;
  onClose: () => void;
}

const labelCls =
  "block text-[11px] font-medium uppercase tracking-wider text-(--color-text-faint) mb-1";
const selectCls =
  "w-full rounded-[var(--radius-btn)] border border-(--color-border) bg-(--color-surface) px-2.5 py-2 text-sm text-(--color-text-strong) focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer";

export function AddTenantModal({ open, onClose }: Props) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [plan, setPlan] = useState<string>("trial");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [referral, setReferral] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { options: planOpts, error: plansError } = usePlanOptions(open, null, plan);

  function handleNameChange(value: string) {
    setName(value);
    setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/provision-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, plan, adminEmail, adminName, referral }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string; detail?: string };

      if (!res.ok) {
        const message = data.detail ?? data.error ?? "Provisioning failed";
        setError(message);
        toast.error("Failed to create tenant", message);
        return;
      }

      toast.success("Tenant created", `${name} has been provisioned.`);
      handleClose();
    } catch {
      const message = "Network error — please try again";
      setError(message);
      toast.error("Failed to create tenant", message);
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setName(""); setSlug(""); setPlan("trial"); setAdminEmail(""); setAdminName(""); setReferral(""); setError(null);
    onClose();
  }

  return (
    <Modal
      title="Provision New Tenant"
      open={open}
      onClose={handleClose}
      footer={
        <div className="flex items-center gap-2 justify-end">
          <Button variant="secondary" type="button" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" form="add-tenant-form" disabled={loading}>
            {loading ? "Provisioning…" : "Create Tenant"}
          </Button>
        </div>
      }
    >
      <form id="add-tenant-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-sm text-(--color-danger) bg-(--color-danger-bg) rounded-[var(--radius-btn)] px-3 py-2">
            {error}
          </p>
        )}

        <Field label="Company Name" required>
          <Input
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Acme GmbH"
          />
        </Field>

        <Field label="Slug" required>
          <Input
            value={slug}
            onChange={(e) =>
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
            }
            placeholder="acme"
          />
          <p className="text-xs text-(--color-text-faint) mt-1">
            Schema: <code className="font-mono">tenant_{slug || "…"}</code>
          </p>
        </Field>

        <div>
          <span className={labelCls}>Plan</span>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className={selectCls}
          >
            {planOpts.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {plansError && (
            <p className="text-xs text-(--color-danger) mt-1">Couldn&apos;t load plans.</p>
          )}
        </div>

        <Field label="Admin Email" required>
          <Input
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder="admin@acme.com"
          />
        </Field>

        <Field label="Admin Name">
          <Input
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            placeholder="Jane Doe"
          />
        </Field>

        <Field label="Referral">
          <Input
            value={referral}
            onChange={(e) => setReferral(e.target.value)}
            placeholder="Referral code or name (optional)"
          />
        </Field>
      </form>
    </Modal>
  );
}
