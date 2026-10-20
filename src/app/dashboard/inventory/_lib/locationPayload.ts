import type { StockLocationType } from "@/types";

export interface LocationPayload {
  name: string;
  type: StockLocationType;
  dispatcher_id?: string | null;
}

/**
 * Insert/update values for LocationModal. `dispatcher_id` (057) is sent ONLY
 * when it differs from the location's current value: a tenant without 057
 * has no such column and PostgREST rejects an unknown key (PGRST204), but such
 * a tenant can never have a dispatcher, so "None"/unchanged saves still work.
 * Dropship suppliers never hold stock, so never dispatch → always null.
 */
export function locationPayload(args: {
  name: string;
  type: StockLocationType;
  dispatcherId: string;
  current: { dispatcher_id?: string | null } | null;
}): LocationPayload {
  const values: LocationPayload = { name: args.name.trim(), type: args.type };
  const next = args.type === "dropship" ? null : args.dispatcherId || null;
  const prev = args.current?.dispatcher_id ?? null;
  if (next !== prev) values.dispatcher_id = next;
  return values;
}
