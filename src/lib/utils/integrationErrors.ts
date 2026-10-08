/**
 * Client-safe error codes + copy for the multi-account integration routes.
 * Routes return `{ error: <code> }`; the UI maps it with integrationErrorMessage.
 * Lives in lib/utils (not lib/integrations) so Client Components can import it.
 */
export const INTEGRATION_ERRORS = {
  INTEGRATION_ACCOUNT_LIMIT:
    "Your plan's account limit for this platform is reached. Pause or disconnect an account, or upgrade your plan.",
  INTEGRATION_ACCOUNT_PAUSED:
    "This account is paused. Resume it on the Integrations page, or upgrade your plan.",
  INTEGRATION_ACCOUNT_UNKNOWN: "That account no longer exists. Refresh the page and try again.",
  INTEGRATION_ACCOUNT_UNIDENTIFIED:
    "We couldn't identify which seller account you signed in with. Please try connecting again.",
} as const;

export type IntegrationErrorCode = keyof typeof INTEGRATION_ERRORS;

export function integrationErrorMessage(code: string | undefined, fallback: string): string {
  return code && code in INTEGRATION_ERRORS ? INTEGRATION_ERRORS[code as IntegrationErrorCode] : fallback;
}
