import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client for the control plane (Project A — kaufnest-control).
 * Never import this in Client Components or expose to the browser.
 * All tables are in the `control` schema — use .schema('control').from('table').
 */
export function createControlClient() {
  return createClient(
    process.env.CONTROL_SUPABASE_URL!,
    process.env.CONTROL_SUPABASE_SERVICE_KEY!
  );
}
