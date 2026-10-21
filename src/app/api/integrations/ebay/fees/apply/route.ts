import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationSuperAdmin } from "@/lib/integrations/authGuard";
import { IntegrationAccountError, requireActiveConnection } from "@/lib/integrations/tokenStore";
import { getTenantEntitlements } from "@/lib/integrations/tenantPlan";
import { applyFeeOverwrites, FeeOverwritePermissionError } from "@/lib/integrations/ebay/feeOverwrite";
import { parseFeeOverwriteApply } from "@/lib/integrations/ebay/feeOverwriteApply";
import { hasPlatformIntegrations, type PlanEntitlements } from "@/lib/plans/entitlements";
import { writeAuditLog } from "@/lib/utils/audit";

// Up to MAX_APPLY_CHANGES guarded updates at bounded concurrency.
export const maxDuration = 60;

/** Writes the approved preview rows, each only if the fee still holds the previewed value. */
export async function POST(req: NextRequest) {
  const auth = await requireIntegrationSuperAdmin();
  if (auth.error) return auth.error;
  const { client, userId, userEmail, tenantSchema } = auth.context;

  let ent: PlanEntitlements;
  try {
    ent = await getTenantEntitlements(tenantSchema);
  } catch (err) {
    console.error("[ebay/fees/apply] plan lookup failed", err);
    return NextResponse.json({ error: "Could not check your plan. Please try again." }, { status: 500 });
  }
  if (!hasPlatformIntegrations(ent)) {
    return NextResponse.json({ error: "Platform integrations are not included in your plan." }, { status: 403 });
  }

  const parsed = parseFeeOverwriteApply(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const conn = await requireActiveConnection(client, parsed.connectionId, ent);
    if (conn.platform !== "ebay") return NextResponse.json({ error: "Not an eBay account" }, { status: 400 });
    const { applied, staleSkipped } = await applyFeeOverwrites(client, parsed.changes);
    await Promise.all(applied.map((c) =>
      writeAuditLog(client, {
        userId, userEmail, action: "update", entityType: "sale", entityId: c.saleId,
        metadata: { source: "ebay_fee_overwrite", field: c.field, from: c.from, to: c.to, connectionId: conn.id },
      })
    ));
    return NextResponse.json({ applied: applied.length, staleSkipped });
  } catch (err) {
    if (err instanceof IntegrationAccountError) return NextResponse.json({ error: err.code }, { status: 409 });
    if (err instanceof FeeOverwritePermissionError) {
      return NextResponse.json({ error: "You don't have permission to edit orders." }, { status: 403 });
    }
    console.error("[ebay/fees/apply] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't update fees. Please try again." }, { status: 502 });
  }
}
