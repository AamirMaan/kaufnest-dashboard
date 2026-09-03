import { createControlClient } from "@/lib/supabase/control";

export type AiKind = "describe" | "aspects";

export interface UsageRow {
  user_id: string;
  kind: AiKind;
  calls: number;
}

/**
 * The billing period a usage row belongs to: the first day of the current
 * month, in UTC. Always UTC — deriving it from local time would move a
 * tenant's quota reset depending on which region the server runs in.
 */
export function currentPeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

/** Total AI calls across every user and both kinds. */
export function sumCalls(rows: UsageRow[]): number {
  return rows.reduce((total, row) => total + row.calls, 0);
}

/** Per-user totals, collapsing `describe` and `aspects` into one number. */
export function callsByUser(rows: UsageRow[]): Record<string, number> {
  const byUser: Record<string, number> = {};
  for (const row of rows) {
    byUser[row.user_id] = (byUser[row.user_id] ?? 0) + row.calls;
  }
  return byUser;
}

/** Every usage row for this tenant in the current period. */
export async function readTenantUsage(tenantId: string): Promise<UsageRow[]> {
  const control = createControlClient();
  const { data, error } = await control
    .schema("control")
    .from("tenant_ai_usage")
    .select("user_id, kind, calls")
    .eq("tenant_id", tenantId)
    .eq("period", currentPeriod());

  if (error) {
    throw new Error(`Failed to read AI usage: ${error.message}`);
  }

  return (data as UsageRow[] | null) ?? [];
}

/**
 * Increment one (tenant, user, period, kind) counter.
 *
 * Delegates to `control.record_ai_usage()` (control-plane migration 008)
 * rather than reading the row and writing back `calls + 1` from here. The
 * read-then-write version lost increments under ordinary concurrency — a
 * double-clicked AI button, or the same form in two tabs, had every request
 * read the same `calls` and write the same `calls + 1`, so N billed Anthropic
 * calls moved the meter by one. The RPC does it in a single
 * `INSERT ... ON CONFLICT DO UPDATE`, which Postgres locks the conflicting
 * row for, so concurrent callers serialise instead of clobbering each other.
 */
export async function recordUsage(args: {
  tenantId: string;
  userId: string;
  kind: AiKind;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const control = createControlClient();

  const { error } = await control.schema("control").rpc("record_ai_usage", {
    p_tenant: args.tenantId,
    p_user: args.userId,
    p_period: currentPeriod(),
    p_kind: args.kind,
    p_in: args.inputTokens,
    p_out: args.outputTokens,
  });

  if (error) {
    throw new Error(`Failed to record AI usage: ${error.message}`);
  }
}
