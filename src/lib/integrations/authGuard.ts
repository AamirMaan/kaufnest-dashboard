import { NextResponse } from "next/server";
import { requireSectionAccess } from "@/lib/permissions/requireSectionAccess";
import type { IntegrationAuthContext, IntegrationAuthResult } from "@/lib/permissions/requireSectionAccess";
import { canOverwriteEbayFees } from "@/lib/utils/feeOverwriteAccess";
import type { Profile } from "@/types";

export type { IntegrationAuthContext, IntegrationAuthResult } from "@/lib/permissions/requireSectionAccess";

/** Integrations routes: section `integrations` at Edit (055). */
export async function requireIntegrationAdmin(): Promise<IntegrationAuthResult> {
  return requireSectionAccess("integrations", 2);
}

export type SuperAdminAuthResult =
  | { context: IntegrationAuthContext & { userEmail: string }; error?: undefined }
  | { context?: undefined; error: NextResponse };

/** eBay fee overwrite: integrations at Edit AND role super_admin (profiles.role). */
export async function requireIntegrationSuperAdmin(): Promise<SuperAdminAuthResult> {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return { error: auth.error };
  const { data, error } = await auth.context.client
    .from("profiles")
    .select("role, email")
    .eq("id", auth.context.userId)
    .maybeSingle<Pick<Profile, "role" | "email">>();
  if (error) {
    console.error("[requireIntegrationSuperAdmin] profile lookup failed", { code: error.code });
    return { error: NextResponse.json({ error: "Could not verify access" }, { status: 500 }) };
  }
  if (!canOverwriteEbayFees(data?.role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { context: { ...auth.context, userEmail: data?.email ?? "" } };
}
