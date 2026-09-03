import type { TenantPlan, TenantStatus } from "@/types";

export const PLAN_VARIANT: Record<TenantPlan, "info" | "success" | "warning" | "danger"> = {
  trial:    "warning",
  starter:  "info",
  pro:      "success",
  business: "danger",
};

export const STATUS_VARIANT: Record<TenantStatus, "success" | "warning" | "danger" | "default"> = {
  active:       "success",
  invited:      "warning",
  provisioning: "warning",
  deactivated:  "danger",
};
