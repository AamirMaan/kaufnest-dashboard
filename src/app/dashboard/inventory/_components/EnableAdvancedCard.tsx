"use client";

import { useState } from "react";
import { Boxes, Loader2 } from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { fetchAdvancedInventory } from "../_store/advancedInventorySlice";

interface Props {
  isAdmin: boolean;
}

export function EnableAdvancedCard({ isAdmin }: Props) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);

  async function handleEnable() {
    setEnabling(true);
    try {
      let res: Response;
      let body: { error?: string };
      try {
        res = await fetch("/api/inventory/enable-advanced", { method: "POST" });
        body = (await res.json().catch(() => ({}))) as { error?: string };
      } catch {
        toastError("Could not enable batches & locations", "Please check your connection and try again.");
        return;
      }
      if (!res.ok) {
        toastError("Could not enable batches & locations", body.error ?? "Please try again.");
        return;
      }

      // The switch is already on server-side at this point — nothing below may
      // surface as an "enable failed" toast. Audit logging is best-effort
      // (writeAuditLog already swallows its own DB errors and returns null).
      try {
        const supabase = await createTenantClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const log = await writeAuditLog(supabase, {
            userId: user.id,
            userEmail: user.email ?? "",
            action: "update",
            entityType: "inventory_settings",
            metadata: { event: "advanced_inventory_enabled" },
          });
          if (log) dispatch(addAuditLog(log));
        }
      } catch {
        // Never let an audit-logging blip report a failed enable.
      }

      await dispatch(fetchAdvancedInventory());
      setConfirmOpen(false);
      success("Batches & locations enabled", "Your current stock is now an opening batch at “Main”.");
    } finally {
      setEnabling(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4">
        <div className="flex items-start gap-3">
          <Boxes size={18} className="mt-0.5 shrink-0 text-(--color-text-muted)" aria-hidden />
          <div>
            <h2 className="text-base font-semibold text-(--color-text-strong)">Batches &amp; locations</h2>
            <p className="mt-1 text-sm text-(--color-text-muted)">
              Track each batch&apos;s landed cost, stock per warehouse, and FIFO cost of goods on every order.
              {!isAdmin && " Ask an admin to turn it on."}
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            Enable
          </Button>
        )}
      </div>

      <Modal
        title="Enable batches & locations?"
        open={confirmOpen}
        onClose={() => { if (!enabling) setConfirmOpen(false); }}
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => setConfirmOpen(false)} disabled={enabling}>
              Cancel
            </Button>
            <Button type="button" onClick={handleEnable} disabled={enabling}>
              {enabling ? <><Loader2 size={15} className="animate-spin" aria-hidden /> Enabling…</> : "Enable"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-(--color-text-base)">
          <p>This creates a “Main” location, sends every platform&apos;s orders from it by default, and turns
            each product&apos;s current stock into an opening batch at a cost of 0 (you can edit that cost later).</p>
          <p>From then on, purchases become batches and every order gets FIFO cost of goods.</p>
          <p className="font-medium text-(--color-text-strong)">This can&apos;t be turned off again.</p>
        </div>
      </Modal>
    </>
  );
}
