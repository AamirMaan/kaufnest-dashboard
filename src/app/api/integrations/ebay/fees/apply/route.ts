import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationSuperAdmin } from "@/lib/integrations/authGuard";
import { IntegrationAccountError, requireActiveConnection } from "@/lib/integrations/tokenStore";
import { getTenantEntitlements } from "@/lib/integrations/tenantPlan";
import { chunks, IN_CHUNK } from "@/lib/integrations/ebay/chargeSync";
import { applyFeeOverwrites, lineCounts } from "@/lib/integrations/ebay/feeOverwrite";
import { parseFeeOverwriteApply } from "@/lib/integrations/ebay/feeOverwriteApply";
import { hasPlatformIntegrations, type PlanEntitlements } from "@/lib/plans/entitlements";

// Up to MAX_APPLY_CHANGES guarded updates at bounded concurrency, then batched audit inserts.
export const maxDuration = 60;

/**
 * Writes the approved preview rows, each only if the fee still holds the previewed
 * value. Partial failures still audit what was written. Response (also on 403/502):
 * `{ applied, stale }` in order lines (sales), `failed` in fee writes, plus `error`.
 */
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

  let conn;
  try {
    conn = await requireActiveConnection(client, parsed.connectionId, ent);
  } catch (err) {
    if (err instanceof IntegrationAccountError) return NextResponse.json({ error: err.code }, { status: 409 });
    console.error("[ebay/fees/apply] connection lookup failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't update fees. Please try again." }, { status: 502 });
  }
  if (conn.platform !== "ebay") return NextResponse.json({ error: "Not an eBay account" }, { status: 400 });

  const result = await applyFeeOverwrites(client, parsed.changes, conn.id);

  // One audit row per written fee, inserted in batches (never one request per row).
  const auditRows = result.applied.map((c) => ({
    user_id: userId, user_email: userEmail, action: "update", entity_type: "sale", entity_id: c.saleId,
    metadata: { source: "ebay_fee_overwrite", field: c.field, from: c.from, to: c.to, connectionId: conn.id },
  }));
  for (const batch of chunks(auditRows, IN_CHUNK)) {
    const { error } = await client.from("audit_logs").insert(batch);
    if (error) console.error("[ebay/fees/apply] audit insert failed:", error.message, { rows: batch.length });
  }

  const counts = { ...lineCounts(result), failed: result.failed };
  if (result.failed > 0) {
    return NextResponse.json(
      {
        ...counts,
        error: result.permissionDenied
          ? "You don't have permission to edit orders."
          : "Some fees couldn't be updated. Please try again.",
      },
      { status: result.permissionDenied ? 403 : 502 }
    );
  }
  return NextResponse.json(counts);
}
