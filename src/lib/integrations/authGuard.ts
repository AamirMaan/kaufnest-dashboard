import { requireSectionAccess } from "@/lib/permissions/requireSectionAccess";
import type { IntegrationAuthResult } from "@/lib/permissions/requireSectionAccess";

export type { IntegrationAuthContext, IntegrationAuthResult } from "@/lib/permissions/requireSectionAccess";

/** Integrations routes: section `integrations` at Edit (055). */
export async function requireIntegrationAdmin(): Promise<IntegrationAuthResult> {
  return requireSectionAccess("integrations", 2);
}
