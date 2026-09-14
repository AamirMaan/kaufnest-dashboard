import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createControlClient, verifyPlatformAdmin } from "@/lib/supabase/control";
import { trelloEnv, statusForList } from "@/lib/support/config";
import { fetchCard } from "@/lib/support/trello";
import type { BugReport } from "@/types";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const forbidden = await verifyPlatformAdmin(user?.email);
  if (forbidden) return forbidden;

  const control = createControlClient();
  const { data: reports, error } = await control
    .schema("control").from("bug_reports").select("*")
    .not("trello_card_id", "is", null)
    .neq("status", "wont_fix")
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<BugReport[]>();

  if (error) {
    console.error("[support/resync] list failed:", error.message);
    return NextResponse.json({ error: "Could not load reports." }, { status: 500 });
  }

  const env = trelloEnv();
  let updated = 0;

  for (const report of reports ?? []) {
    try {
      const card = await fetchCard({ env, cardId: report.trello_card_id! });
      const status = statusForList(card.idList, env.statusMap);
      const patch: Record<string, string> = { last_synced_at: new Date().toISOString() };

      if (status !== report.status) {
        patch.status = status;
        patch.updated_at = new Date().toISOString();
        updated += 1;
      }

      await control.schema("control").from("bug_reports").update(patch).eq("id", report.id);
    } catch (err) {
      // A deleted card shouldn't abort the sweep.
      console.error(`[support/resync] card ${report.trello_card_id} failed:`, err);
    }
  }

  return NextResponse.json({ checked: reports?.length ?? 0, updated });
}
