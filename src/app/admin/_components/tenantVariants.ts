import type { TenantStatus } from "@/types";

type PlanBadgeVariant = "info" | "success" | "warning" | "danger" | "default";

const KNOWN_PLAN_VARIANT: Record<string, PlanBadgeVariant> = {
  trial:    "warning",
  starter:  "info",
  pro:      "success",
  business: "danger",
};

/** Badge colour for a plan key. Admin-created plans fall back to "default". */
export function planVariant(key: string): PlanBadgeVariant {
  return Object.hasOwn(KNOWN_PLAN_VARIANT, key) ? KNOWN_PLAN_VARIANT[key] : "default";
}

export const STATUS_VARIANT: Record<TenantStatus, "success" | "warning" | "danger" | "default"> = {
  active:       "success",
  invited:      "warning",
  provisioning: "warning",
  deactivated:  "danger",
};
