import { NextRequest, NextResponse } from "next/server";

/** Cookie holding the connection id the admin chose to reconnect (connect → callback). */
export const OAUTH_TARGET_COOKIE = "kn_oauth_target";

/**
 * Redirect back to the Integrations page. The connect and callback routes are
 * full-page navigations, so failures must land here (the page toasts
 * `error=`), never on a raw JSON body.
 */
export function redirectToIntegrations(req: NextRequest, query: Record<string, string>): NextResponse {
  // Use NEXT_PUBLIC_SITE_URL so the redirect always resolves to the public
  // hostname — req.url can be an internal Vercel URL behind a reverse proxy.
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const url = new URL("/dashboard/integrations", base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}
