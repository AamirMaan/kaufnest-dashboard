"use client";

import { Modal } from "@/components/ui/Modal";
import { AiUsageBreakdown } from "./AiUsageBreakdown";
import type { Tenant } from "@/types";

interface Props {
  open: boolean;
  tenant: Tenant;
  used: number;
  limit: number;
  byUser: Record<string, number>;
  onClose: () => void;
}

export function AiUsageModal({ open, tenant, used, limit, byUser, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={`AI Usage — ${tenant.name}`}>
      <AiUsageBreakdown used={used} limit={limit} byUser={byUser} />
    </Modal>
  );
}
