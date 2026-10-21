import type { ReviewResponse } from "@/app/api/integrations/review/route";

/** Accounts whose orders could not be fetched. Non-fatal `warnings` (orders loaded) never count. */
export function failedAccountCount(resp: Pick<ReviewResponse, "errors" | "warnings">): number {
  return Object.keys(resp.errors ?? {}).length;
}
