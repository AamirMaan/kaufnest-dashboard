"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { Tenant } from "@/types";

interface Props {
  tenant: Tenant;
}

export function TenantActions({ tenant }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleImpersonate() {
    const email = window.prompt(
      `Enter the super_admin email address for tenant "${tenant.name}":`
    );
    if (!email) return;

    setLoading(true);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id, adminEmail: email }),
      });

      const data = (await res.json()) as { ok?: boolean; magicLink?: string; error?: string };

      if (!res.ok || !data.magicLink) {
        alert(data.error ?? "Impersonation failed");
        return;
      }

      window.location.href = data.magicLink;
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="secondary" onClick={handleImpersonate} disabled={loading}>
      {loading ? "Loading…" : "Impersonate"}
    </Button>
  );
}
