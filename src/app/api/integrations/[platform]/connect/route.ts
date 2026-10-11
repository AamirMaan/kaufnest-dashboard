import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getAdapter, isIntegrationPlatform } from "@/lib/integrations/registry";
import { listConnections } from "@/lib/integrations/tokenStore";
import { getTenantEntitlements } from "@/lib/integrations/tenantPlan";
import { connectPrecheck } from "@/lib/integrations/connectionSave";
import { isConnectionId } from "@/lib/integrations/connectionPatch";
import { OAUTH_TARGET_COOKIE, redirectToIntegrations } from "@/lib/integrations/redirect";
import { hasPlatformIntegrations, type PlanEntitlements } from "@/lib/plans/entitlements";
import type { IntegrationErrorCode } from "@/lib/utils/integrationErrors";

const PRECHECK_ERRORS: Record<"limit" | "legacy_pending" | "unknown_target", IntegrationErrorCode> = {
  limit: "INTEGRATION_ACCOUNT_LIMIT",
  legacy_pending: "INTEGRATION_LEGACY_RECONNECT",
  unknown_target: "INTEGRATION_ACCOUNT_UNKNOWN",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isIntegrationPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, tenantSchema } = auth.context;

  // A full-page navigation (window.location.assign), so every refusal
  // redirects back to Integrations with an error code the page toasts.
  let ent: PlanEntitlements;
  try {
    ent = await getTenantEntitlements(tenantSchema);
  } catch (err) {
    console.error("[integrations/connect] plan lookup failed", err);
    return redirectToIntegrations(req, { error: "Could not check your plan. Please try again.", platform });
  }
  if (!hasPlatformIntegrations(ent)) {
    return redirectToIntegrations(req, {
      error: "Platform integrations are not included in your plan.",
      platform,
    });
  }

  // ?reconnect=<connectionId> reconnects that account (skips the cap; the
  // callback re-checks via decideConnectionSave, and only a targeted legacy
  // row is ever adopted). No param = add a new account.
  const reconnect = req.nextUrl.searchParams.get("reconnect");
  const targetId = reconnect && isConnectionId(reconnect) ? reconnect : null;
  if (reconnect && !targetId) {
    return redirectToIntegrations(req, { error: PRECHECK_ERRORS.unknown_target, platform });
  }

  const check = connectPrecheck(await listConnections(client, platform), platform, ent, targetId);
  if (check !== "ok") {
    return redirectToIntegrations(req, { error: PRECHECK_ERRORS[check], platform });
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
  if (targetId) {
    response.cookies.set(OAUTH_TARGET_COOKIE, targetId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  } else {
    // A stale target from an abandoned reconnect must not turn this "Add
    // account" into an adopt.
    response.cookies.delete(OAUTH_TARGET_COOKIE);
  }

  return response;
}
