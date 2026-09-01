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
 * Increment one (tenant, user, period, kind) counter. Read-then-write rather
 * than an atomic RPC: a lost update under concurrency undercounts by one
 * call, which is acceptable for a soft quota and not worth a DB function.
 */
export async function recordUsage(args: {
  tenantId: string;
  userId: string;
  kind: AiKind;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const control = createControlClient();
  const period = currentPeriod();

  const { data: existing, error: readError } = await control
    .schema("control")
    .from("tenant_ai_usage")
    .select("calls, input_tokens, output_tokens")
    .eq("tenant_id", args.tenantId)
    .eq("user_id", args.userId)
    .eq("period", period)
    .eq("kind", args.kind)
    .maybeSingle();

  if (readError) {
    throw new Error(`Failed to read existing AI usage: ${readError.message}`);
  }

  const prev = (existing as
    | { calls: number; input_tokens: number; output_tokens: number }
    | null) ?? { calls: 0, input_tokens: 0, output_tokens: 0 };

  const { error: upsertError } = await control
    .schema("control")
    .from("tenant_ai_usage")
    .upsert(
      {
        tenant_id: args.tenantId,
        user_id: args.userId,
        period,
        kind: args.kind,
        calls: prev.calls + 1,
        input_tokens: prev.input_tokens + args.inputTokens,
        output_tokens: prev.output_tokens + args.outputTokens,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,user_id,period,kind" }
    );

  if (upsertError) {
    throw new Error(`Failed to record AI usage: ${upsertError.message}`);
  }
}
