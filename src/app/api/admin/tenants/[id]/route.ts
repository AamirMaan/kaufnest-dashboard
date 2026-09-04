import { NextRequest, NextResponse } from "next/server";
import { createControlClient } from "@/lib/supabase/control";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { removeExposedSchema } from "@/lib/supabase/managementApi";
import { verifyPlatformAdmin } from "../route";
import type { TenantPlan, TenantStatus } from "@/types";

function makeServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await verifyPlatformAdmin();
  if (!check.ok) return check.response;

  const { id } = await params;
  const body = (await req.json()) as {
    plan?: TenantPlan;
    status?: TenantStatus;
    admin_email?: string;
    ai_enabled?: boolean;
    referral?: string;
  };

  const control = createControlClient();

  // 1. Fetch current tenant to compare old email and confirm existence
  const { data: tenant, error: fetchError } = await control
    .schema("control")
    .from("tenants")
    .select("admin_email, plan, status")
    .eq("id", id)
    .single();

  if (fetchError) {
    if ((fetchError as { code?: string }).code === "PGRST116") {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Failed to fetch tenant", detail: errorMessage(fetchError) },
      { status: 500 }
    );
  }
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  // 2. If admin_email changed, update in Project B Auth first.
  // Auth update happens before control update so that if it fails,
  // we return an error before writing anything to control.tenants.
  if (body.admin_email && body.admin_email !== tenant.admin_email) {
    try {
      const service = makeServiceClient();

      // No getUserByEmail in the Supabase JS admin API — scan all users.
      // perPage: 1000 avoids the default 50-row cap silently truncating results.
      const { data: { users }, error: listError } = await service.auth.admin.listUsers({ perPage: 1000 });
      if (listError) throw listError;

      const authUser = users.find((u) => u.email === tenant.admin_email);
      if (!authUser) {
        throw new Error(
          `No auth user found for current email "${tenant.admin_email}"`
        );
      }

      const { error: updateEmailError } = await service.auth.admin.updateUserById(
        authUser.id,
        { email: body.admin_email }
      );
      if (updateEmailError) throw updateEmailError;
    } catch (err) {
      return NextResponse.json(
        { error: "Failed to update admin email", detail: errorMessage(err) },
        { status: 500 }
      );
    }
  }

  // 3. Build partial patch — only include fields that were sent
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.plan !== undefined) patch.plan = body.plan;
  if (body.status !== undefined) patch.status = body.status;
  if (body.admin_email !== undefined && body.admin_email !== "") patch.admin_email = body.admin_email;
  if (body.ai_enabled !== undefined) patch.ai_enabled = body.ai_enabled;
  if (body.referral !== undefined) {
    patch.referral = body.referral.trim() === "" ? null : body.referral.trim();
  }

  const { data: updated, error: patchError } = await control
    .schema("control")
    .from("tenants")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (patchError) {
    return NextResponse.json(
      { error: "Failed to update tenant", detail: errorMessage(patchError) },
      { status: 500 }
    );
  }

  return NextResponse.json({ tenant: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = await verifyPlatformAdmin();
  if (!check.ok) return check.response;

  const { id } = await params;
  const control = createControlClient();

  // 1. Fetch tenant to get schema_name
  const { data: tenant, error: fetchError } = await control
    .schema("control")
    .from("tenants")
    .select("schema_name, name")
    .eq("id", id)
    .single();

  if (fetchError) {
    if ((fetchError as { code?: string }).code === "PGRST116") {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Failed to fetch tenant", detail: errorMessage(fetchError) },
      { status: 500 }
    );
  }
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const service = makeServiceClient();

  // 2a. Remove schema from PostgREST "Exposed schemas" BEFORE dropping it.
  // Order matters: if a dropped schema remains in the exposed list, PostgREST's
  // schema-cache load fails (3F000) and the whole Data API breaks for every
  // tenant (PGRST002). Doing this first means a failure here aborts cleanly,
  // and a later drop failure leaves the schema unexposed but intact — retryable.
  try {
    await removeExposedSchema(tenant.schema_name);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to unexpose tenant schema", detail: errorMessage(err) },
      { status: 500 }
    );
  }

  // 2b. Drop the tenant schema (IF EXISTS — safe to retry if schema was already gone)
  const { error: dropError } = await service.rpc("drop_tenant_schema", {
    schema_name: tenant.schema_name,
  });
  if (dropError) {
    return NextResponse.json(
      { error: "Failed to drop tenant schema", detail: errorMessage(dropError) },
      { status: 500 }
    );
  }

  // 3. Delete auth users belonging to this tenant (best-effort — schema is already gone)
  const { data: { users }, error: listError } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (!listError) {
    const tenantUsers = users.filter(
      (u) => u.app_metadata?.tenant_schema === tenant.schema_name
    );
    await Promise.allSettled(
      tenantUsers.map((u) => service.auth.admin.deleteUser(u.id))
    );
  }

  // 4. Remove the control-plane record
  const { error: deleteError } = await control
    .schema("control")
    .from("tenants")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return NextResponse.json(
      { error: "Schema dropped but failed to remove tenant record", detail: errorMessage(deleteError) },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
