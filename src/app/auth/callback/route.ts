import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Auth callback route.
 *
 * Supabase redirects here after:
 *  - An invited user clicks the invite email link  (next=/set-password)
 *  - A user clicks the password-reset email link   (next=/set-password)
 *
 * The URL contains a PKCE `code` that must be exchanged for a session.
 * After exchange we redirect to `next` (defaults to /dashboard).
 *
 * Configure in Supabase Dashboard → Authentication → URL Configuration:
 *   Redirect URL: https://dashboard.kaufnest.com/auth/callback
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Something went wrong — send to login with an error flag
  return NextResponse.redirect(`${origin}/login?error=invalid_link`);
}
