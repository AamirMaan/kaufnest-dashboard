import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditAction, AuditEntity, AuditLog } from "@/types";

interface WriteAuditLogParams {
  userId: string;
  userEmail: string;
  action: AuditAction;
  entityType: AuditEntity;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Writes a single audit log entry to Supabase and returns the inserted row.
 * Fire-and-forget safe: errors are swallowed so they never block the primary action.
 */
export async function writeAuditLog(
  supabase: SupabaseClient,
  params: WriteAuditLogParams
): Promise<AuditLog | null> {
  const { data } = await supabase
    .from("audit_logs")
    .insert({
      user_id: params.userId,
      user_email: params.userEmail,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      metadata: params.metadata ?? null,
    })
    .select()
    .single<AuditLog>();

  return data;
}
