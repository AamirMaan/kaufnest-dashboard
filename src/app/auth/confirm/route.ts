import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Auth confirm route.
 *
 * Supabase email links (invite, password reset) point here with a
 * `token_hash` + `type` rather than `{{ .ConfirmationURL }}`'s `*.supabase.co`
 * verify link — corporate email security scanners pre-fetch `*.supabase.co`
 * links and burn the single-use token before the real user clicks
 * (https://supabase.com/docs/guides/troubleshooting/otp-verification-failures-token-has-expired-or-otp_expired-errors-5ee4d0).
 * Routing through our own domain first avoids that.
 *
 * Configure in Supabase Dashboard → Authentication → URL Configuration:
 *   Redirect URLs: https://dashboard.kaufnest.com/auth/confirm**
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Something went wrong — send to login with an error flag
  return NextResponse.redirect(`${origin}/login?error=invalid_link`);
}
