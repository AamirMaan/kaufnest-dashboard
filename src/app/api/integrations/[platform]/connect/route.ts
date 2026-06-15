import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getAdapter, isIntegrationPlatform } from "@/lib/integrations/registry";
import { createControlClient } from "@/lib/supabase/control";
import { hasPlatformIntegrations } from "@/lib/utils/planGating";
import type { TenantPlan } from "@/types";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isIntegrationPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { tenantSchema } = auth.context;

  const control = createControlClient();
  const { data: tenant } = await control
    .schema("control")
    .from("tenants")
    .select("plan")
    .eq("schema_name", tenantSchema)
    .single();

  const plan = (tenant?.plan ?? "trial") as TenantPlan;
  if (!hasPlatformIntegrations(plan)) {
    return NextResponse.json(
      { error: "Platform integrations require the Pro or Business plan." },
      { status: 403 }
    );
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
