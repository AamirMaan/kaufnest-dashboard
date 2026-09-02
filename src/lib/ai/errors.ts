import Anthropic from "@anthropic-ai/sdk";

/**
 * Map provider errors to copy a seller can act on. Raw provider errors must
 * never reach the client — the same rule this codebase applies to Postgres
 * errors, and the verifier flags violations of it.
 */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) {
    return "The AI service is busy. Try again in a moment.";
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return "AI is not configured correctly. Contact support.";
  }
  if (err instanceof Anthropic.APIError) {
    return "The AI service could not complete this request. Try again.";
  }
  return "Something went wrong. Try again.";
}
