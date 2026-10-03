import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getAdapter, isIntegrationPlatform } from "@/lib/integrations/registry";
import { createControlClient } from "@/lib/supabase/control";
import { getEntitlements } from "@/lib/plans/catalog";
import { hasPlatformIntegrations, type PlanEntitlements } from "@/lib/plans/entitlements";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isIntegrationPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { tenantSchema } = auth.context;

  const control = createControlClient();
  const { data: tenant, error: tenantError } = await control
    .schema("control")
    .from("tenants")
    .select("plan")
    .eq("schema_name", tenantSchema)
    .maybeSingle<{ plan: string }>();
  if (tenantError) {
    console.error("[integrations/connect] tenant lookup failed", tenantError.message);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }

  let ent: PlanEntitlements;
  try {
    ent = await getEntitlements(tenant?.plan ?? null);
  } catch (err) {
    console.error("[integrations/connect] plan lookup failed", err);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }
  if (!hasPlatformIntegrations(ent)) {
    return NextResponse.json({ error: "Platform integrations are not included in your plan." }, { status: 403 });
  }

  const adapter = getAdapter(platform);
  const state = randomUUID();

  const response = NextResponse.redirect(adapter.getAuthUrl(state));
  response.cookies.set("kn_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
