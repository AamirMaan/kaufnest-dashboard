import { NextResponse } from "next/server";
import { createClient, createServiceClientForTenant } from "@/lib/supabase/server";
import { createControlClient } from "@/lib/supabase/control";
import { addExposedSchema, removeExposedSchema } from "@/lib/supabase/managementApi";
import { slugForCompany, nextAvailableSlug, schemaNameFor } from "@/lib/utils/tenantSlug";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// Provisioning creates ~13 tables with RLS, triggers and indexes, then waits
// on a PostgREST schema-cache reload. Comfortably past a default serverless
// timeout, so the budget is raised explicitly.
export const maxDuration = 60;

const TRIAL_DAYS = 14;

// Supabase's PostgrestError/AuthError carry a `.message` but aren't always
// `instanceof Error` — String(err) on those yields "[object Object]".
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  // Already has a tenant — nothing to do. Covers a user re-visiting /welcome
  // after a successful run.
  if (user.app_metadata?.tenant_schema) {
    return NextResponse.json({ ok: true, alreadyProvisioned: true });
  }

  const companyName =
    typeof user.user_metadata?.company_name === "string"
      ? user.user_metadata.company_name.trim()
      : undefined;
  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name.trim()
      : "";
  const referral =
    typeof user.user_metadata?.referral === "string" && user.user_metadata.referral.trim() !== ""
      ? user.user_metadata.referral.trim()
      : null;

  if (!companyName) {
    // Not a self-serve signup (an admin-invited user has no company_name),
    // so there is nothing this route can safely provision.
    return NextResponse.json(
      { error: "This account is not a self-serve signup." },
      { status: 400 }
    );
  }

  const control = createControlClient();

  // Claim a slug. The unique index on admin_email (control-plane/005) — not
  // this read — is what actually prevents double-provisioning; this only
  // picks a name that is free right now.
  const { data: takenRows } = await control
    .schema("control")
    .from("tenants")
    .select("slug");

  const base = slugForCompany(companyName, user.email);
  let slug: string;
  try {
    slug = nextAvailableSlug(base, (takenRows ?? []).map((r) => r.slug as string));
  } catch (err) {
    console.error("[signup/provision] slug allocation failed:", errorMessage(err));
    return NextResponse.json({ error: "Could not allocate a workspace name." }, { status: 500 });
  }
  let schemaName = schemaNameFor(slug);

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

  // Claim BEFORE any expensive work, so a refresh or a concurrent request
  // collides on the unique admin_email index instead of building a second
  // schema. Status stays 'provisioning' until every step below succeeds, so a
  // crash leaves a visible row in /admin rather than an invisible half-tenant.
  const { error: claimError } = await control
    .schema("control")
    .from("tenants")
    .insert({
      name: companyName,
      slug,
      schema_name: schemaName,
      admin_email: user.email,
      plan: "trial",
      status: "provisioning",
      trial_ends_at: trialEnd.toISOString(),
      referral,
    });

  if (claimError) {
    if (claimError.code !== "23505") {
      console.error("[signup/provision] claim failed:", claimError.message);
      return NextResponse.json({ error: "Could not start setting up your workspace." }, { status: 500 });
    }

    // 23505 = unique_violation on admin_email. Either a concurrent request,
    // or an earlier attempt that died partway. Resume that row rather than
    // reporting success for a workspace that was never finished. A `status`
    // other than provisioning/active means this email already belongs to a
    // tenant relationship this flow didn't create (an admin invite, a
    // deactivated tenant) — refuse rather than resume.
    const { data: existing } = await control
      .schema("control")
      .from("tenants")
      .select("schema_name, status")
      .eq("admin_email", user.email)
      .single<{ schema_name: string; status: string }>();

    if (!existing) {
      return NextResponse.json({ error: "Could not start setting up your workspace." }, { status: 500 });
    }
    if (existing.status === "active") {
      return NextResponse.json({ ok: true, alreadyProvisioned: true });
    }
    if (existing.status !== "provisioning") {
      // "invited" (admin-created tenant, not yet accepted) or "deactivated" —
      // this email already belongs to a tenant relationship this self-serve
      // flow did not create. Resuming/reactivating it here would be wrong
      // regardless of how it was reached, so refuse rather than guess.
      console.error(
        `[signup/provision] admin_email collision with existing status="${existing.status}" — refusing to resume`
      );
      return NextResponse.json(
        { error: "This email is already associated with an existing workspace. Please contact support." },
        { status: 409 }
      );
    }
    schemaName = existing.schema_name;
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Every step below is written to be safely re-runnable, because a resumed
    // attempt (above) re-executes all of them.
    const { error: schemaError } = await service.rpc("provision_tenant_schema", {
      schema_name: schemaName,
    });
    if (schemaError) throw schemaError;

    // MUST precede the tenant-scoped writes below: PostgREST rejects requests
    // against a schema that isn't in the exposed list with 404/406.
    await addExposedSchema(schemaName);

    const tenantService = createServiceClientForTenant(schemaName);

    const { data: existingProfileRow } = await tenantService
      .from("company_profile")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (!existingProfileRow) {
      const { error: seedError } = await tenantService
        .from("company_profile")
        .insert({ name: companyName, currency: "EUR", timezone: "UTC" });
      if (seedError) throw seedError;
    }

    const { data: existingUserProfile } = await tenantService
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (!existingUserProfile) {
      const { error: profileError } = await tenantService.from("profiles").insert({
        id: user.id,
        email: user.email,
        full_name: fullName,
        role: "super_admin",
      });
      if (profileError) throw profileError;
    }

    // Canonical writer for app_metadata.tenant_schema. The caller MUST
    // refresh its session afterwards — see /welcome.
    const { error: stampError } = await service.rpc("set_user_tenant", {
      user_id: user.id,
      schema_name: schemaName,
    });
    if (stampError) throw stampError;

    const { error: activateError } = await control
      .schema("control")
      .from("tenants")
      .update({ status: "active" })
      .eq("schema_name", schemaName);
    if (activateError) throw activateError;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[signup/provision] failed:", errorMessage(err));

    // Full rollback rather than leaving a resumable-but-broken state.
    // Confirmed live 2026-09-01: an undocumented DB constraint made every
    // self-serve signup fail here, leaving a confirmed auth user with no
    // tenant and no way to ever complete provisioning — permanently stuck
    // on /login with no self-service recovery. Worse, once this schema's
    // slug is freed up (below), a LATER, unrelated signup could land on
    // the exact same schema name and silently inherit this attempt's
    // `company_profile` row via the existingProfileRow check above, if the
    // schema itself weren't also dropped. Best-effort: log each step but
    // never let a cleanup failure mask the original error or block the
    // response — a partially-rolled-back attempt is still strictly better
    // than the pre-2026-09-01 permanently-wedged state.
    try {
      await removeExposedSchema(schemaName);
    } catch (cleanupErr) {
      console.error("[signup/provision] rollback: unexpose schema failed:", errorMessage(cleanupErr));
    }
    try {
      const { error: dropError } = await service.rpc("drop_tenant_schema", { schema_name: schemaName });
      if (dropError) throw dropError;
    } catch (cleanupErr) {
      console.error("[signup/provision] rollback: drop schema failed:", errorMessage(cleanupErr));
    }
    try {
      const { error: deleteUserError } = await service.auth.admin.deleteUser(user.id);
      if (deleteUserError) throw deleteUserError;
    } catch (cleanupErr) {
      console.error("[signup/provision] rollback: delete auth user failed:", errorMessage(cleanupErr));
    }
    try {
      const { error: deleteTenantError } = await control
        .schema("control")
        .from("tenants")
        .delete()
        .eq("schema_name", schemaName);
      if (deleteTenantError) throw deleteTenantError;
    } catch (cleanupErr) {
      console.error("[signup/provision] rollback: delete tenants row failed:", errorMessage(cleanupErr));
    }

    return NextResponse.json(
      { error: "We couldn't finish setting up your workspace. Please sign up again." },
      { status: 500 }
    );
  }
}
