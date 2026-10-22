/**
 * Client-safe error codes + copy for the multi-account integration routes.
 * Routes return `{ error: <code> }`; the UI maps it with integrationErrorMessage.
 * Lives in lib/utils (not lib/integrations) so Client Components can import it.
 */
export const INTEGRATION_ERRORS = {
  // Adding an account: every account still holding tokens counts, paused ones included.
  INTEGRATION_ACCOUNT_LIMIT:
    "Your plan's account limit for this platform is reached (paused accounts count too). Disconnect an account, or upgrade your plan.",
  // Resuming a paused account: only non-paused accounts count, so pausing another frees a slot.
  INTEGRATION_RESUME_LIMIT:
    "Your plan's active-account limit for this platform is reached. Pause another account first, or upgrade your plan.",
  INTEGRATION_LEGACY_RECONNECT:
    "Reconnect your existing eBay account first (Reconnect on its card), so it can be told apart from new accounts.",
  INTEGRATION_ACCOUNT_DISCONNECTED:
    "This order's account isn't connected. Reconnect it on the Integrations page, then try again.",
  INTEGRATION_ACCOUNT_AMBIGUOUS:
    "This order isn't assigned to an eBay account. Set its account (Edit order), then try again.",
  INTEGRATION_ACCOUNT_PAUSED:
    "This account is paused. Resume it on the Integrations page, or upgrade your plan.",
  INTEGRATION_ACCOUNT_UNKNOWN: "That account no longer exists. Refresh the page and try again.",
  // An active account's card has no Reconnect button; Disconnect brings it back.
  INTEGRATION_FINANCES_SCOPE:
    "Reconnect this eBay account to import eBay fees and charges: on Integrations, Disconnect it, then Reconnect.",
  // EU/UK sellers' Finances calls must be digitally signed; reconnecting won't help.
  // Covers both "no key configured" and "key rejected" (expired, wrong JWE).
  INTEGRATION_FINANCES_SIGNATURE:
    "eBay rejected this app's request signature, which it requires to import fees for this account. Reconnecting won't help — please contact support.",
  // Fee overwrite preview: the picked window held too many transactions (page cap) or timed out.
  INTEGRATION_FINANCES_WINDOW_TOO_LARGE:
    "eBay has too many transactions since that date to check at once. Pick a later \"Orders from\" date.",
  INTEGRATION_FINANCES_DB_PENDING:
    "eBay charge import isn't available yet — a database update is pending. Please try again later.",
  INTEGRATION_ACCOUNT_UNIDENTIFIED:
    "We couldn't identify which seller account you signed in with. Please try connecting again.",
} as const;

export type IntegrationErrorCode = keyof typeof INTEGRATION_ERRORS;

export function integrationErrorMessage(code: string | undefined, fallback: string): string {
  return code && Object.hasOwn(INTEGRATION_ERRORS, code) ? INTEGRATION_ERRORS[code as IntegrationErrorCode] : fallback;
}
