#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Creates a fully active tenant user directly (email pre-confirmed, password
// already set) — bypasses Supabase's invite email entirely. Use this when
// `/api/users/invite` (which calls `inviteUserByEmail`) can't be relied on
// because invite emails aren't being delivered.
//
// Does exactly what /api/users/invite/route.ts does, except:
//   inviteUserByEmail(email, {...})   -->   createUser({ email, password, email_confirm: true, ... })
// Same profile-insert + set_user_tenant steps follow, so the resulting user
// is indistinguishable from one who went through the normal invite flow —
// they can log in immediately with the password you set here (no forced
// password reset on first login, unlike the invite flow's set-password step).
//
// Usage (service-role key comes from .env.local):
//   node --env-file=.env.local scripts/create-tenant-user.mjs \
//     --email=user@example.com --name="Full Name" --password='...' \
//     [--role=accountant] [--schema=tenant_kaufnest] [--reset-password]
//
// If a profile for this email already exists in the target schema (e.g. a
// prior invite got as far as creating the auth user + profile row, but the
// invite EMAIL itself never arrived — those DB steps don't depend on
// delivery), pass --reset-password to set/confirm a password on that
// existing account instead of trying to create a new one. Without the flag,
// this refuses to touch an existing account.
//
// SECURITY: the password is passed on the command line / in your shell
// history for this one run — pick a shell that doesn't persist history for
// this command, or clear history afterward, and tell the user to change
// their password after first login if you'd rather not have it linger
// anywhere.
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js";

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

const { email, name, password, role = "accountant", schema = "tenant_kaufnest" } = parseArgs();
const resetPassword = process.argv.includes("--reset-password");

if (!email || !name || !password) {
  console.error(
    'Usage: node --env-file=.env.local scripts/create-tenant-user.mjs --email=... --name="..." --password=\'...\' [--role=accountant] [--schema=tenant_kaufnest]'
  );
  process.exit(1);
}

const VALID_ROLES = ["super_admin", "admin", "accountant"];
if (!VALID_ROLES.includes(role)) {
  console.error(`Invalid role "${role}" — must be one of: ${VALID_ROLES.join(", ")}`);
  process.exit(1);
}

async function main() {
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const tenantClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { db: { schema } }
  );

  // Guard against duplicates the same way /api/users/invite does.
  const { data: existingProfile } = await tenantClient
    .from("profiles")
    .select("id, full_name, role")
    .ilike("email", email)
    .maybeSingle();

  if (existingProfile) {
    if (!resetPassword) {
      console.error(`A user with email "${email}" already exists in ${schema}.profiles.`);
      console.error("Re-run with --reset-password to set/confirm a password on that existing account instead.");
      process.exit(1);
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(existingProfile.id, {
      password,
      email_confirm: true,
    });

    if (updateError) {
      console.error("Failed to update existing user's password:", updateError.message);
      process.exit(1);
    }

    // Re-stamp tenant_schema as a safety net in case the original invite
    // attempt failed partway through before reaching this step.
    const { error: rpcError } = await adminClient.rpc("set_user_tenant", {
      user_id: existingProfile.id,
      schema_name: schema,
    });

    if (rpcError) {
      console.error("Password updated, but set_user_tenant RPC failed:", rpcError.message);
      console.error(`app_metadata.tenant_schema may not be stamped for user id ${existingProfile.id} — this user may not be able to log in until it is.`);
      process.exit(1);
    }

    console.log(
      `Done. Existing user ${email} (${existingProfile.full_name || name}, role "${existingProfile.role}") now has the new password and a confirmed email — ready to log in immediately.`
    );
    return;
  }

  const { data: userData, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation email sent, account is immediately active
    user_metadata: { full_name: name, tenant_schema: schema, role },
  });

  if (createError) {
    console.error("Failed to create auth user:", createError.message);
    process.exit(1);
  }

  const userId = userData.user.id;

  const { error: profileError } = await tenantClient.from("profiles").insert({
    id: userId,
    email,
    full_name: name,
    role,
  });

  if (profileError) {
    console.error("Auth user was created, but the profile insert failed:", profileError.message);
    console.error(`You'll need to insert into ${schema}.profiles manually for user id ${userId}.`);
    process.exit(1);
  }

  const { error: rpcError } = await adminClient.rpc("set_user_tenant", {
    user_id: userId,
    schema_name: schema,
  });

  if (rpcError) {
    console.error("Profile created, but set_user_tenant RPC failed:", rpcError.message);
    console.error(`app_metadata.tenant_schema was NOT stamped for user id ${userId} — this user will not be able to log in until it is.`);
    process.exit(1);
  }

  console.log(`Done. ${email} (${name}) created as "${role}" in ${schema}, ready to log in immediately.`);
}

main();
