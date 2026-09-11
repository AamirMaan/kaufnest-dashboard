"use client";

import { useEffect } from "react";
import { Field, Input, Select, Row, Checkbox } from "@/components/ui/FormFields";
import { Button } from "@/components/ui/Button";
import { createTenantClient } from "@/lib/supabase/client";
import {
  NEW_CAMPAIGN,
  MIN_AD_RATE,
  MAX_AD_RATE,
  type DraftFormState,
} from "../_lib/wizardValidation";
import { resolveCampaignSelection } from "../_lib/campaignSelection";
import { MarketingReconnectNotice } from "./MarketingReconnectNotice";
import type { MarketingAccess } from "./useEbayCampaigns";

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
  access: MarketingAccess;
  onRetry: () => void;
}

export function AdvertisingSection({ draft, setDraft, access, onRetry }: Props) {
  /* Prefill rate + campaign from the most recently advertised listing, so a
   * repeat listing is one tick of the checkbox. Mount-only and only while
   * this draft has no rate of its own — it must never overwrite a value the
   * seller entered. The toggle itself stays off. */
  useEffect(() => {
    if (draft.ad_rate) return;
    let cancelled = false;
    Promise.resolve().then(async () => {
      const supabase = await createTenantClient();
      const { data } = await supabase
        .from("ebay_listing_drafts")
        .select("ad_rate, ad_campaign_id")
        .not("ad_rate", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ ad_rate: number; ad_campaign_id: string | null }>();
      if (cancelled || !data) return;
      setDraft({
        ad_rate: String(data.ad_rate),
        ...(data.ad_campaign_id ? { ad_campaign_id: data.ad_campaign_id } : {}),
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const campaigns = access.status === "ready" ? access.campaigns : null;

  /* Keep the dropdown on a real option once campaigns load (or the prefill
   * lands): an ended campaign, or nothing chosen yet, resolves to the first
   * campaign / auto-create. */
  useEffect(() => {
    if (!campaigns) return;
    const next = resolveCampaignSelection(draft.ad_campaign_id, campaigns);
    if (next !== draft.ad_campaign_id) setDraft({ ad_campaign_id: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, draft.ad_campaign_id]);

  if (access.status === "reconnect") return <MarketingReconnectNotice />;

  return (
    <div className="space-y-4">
      <Checkbox
        label="Promote this listing — you only pay the ad rate when it sells through an ad"
        checked={draft.ad_enabled}
        disabled={access.status !== "ready"}
        onChange={(e) => setDraft({ ad_enabled: e.target.checked })}
      />

      {access.status === "loading" && (
        <p className="text-sm text-(--color-text-muted)">Loading your campaigns…</p>
      )}

      {access.status === "error" && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-(--color-danger-text)">
          <span>Couldn&apos;t load your campaigns: {access.message}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}

      {draft.ad_enabled && campaigns && (
        <Row>
          <Field label="Ad rate (%)" required>
            <Input
              required
              type="number"
              min={MIN_AD_RATE}
              max={MAX_AD_RATE}
              step="0.1"
              value={draft.ad_rate}
              onChange={(e) => setDraft({ ad_rate: e.target.value })}
            />
            <p className="mt-1 text-xs text-(--color-text-faint)">
              A share of the sale price, charged only when a buyer clicks the ad and buys.
            </p>
          </Field>
          <Field label="Campaign" required>
            <Select
              required
              value={draft.ad_campaign_id}
              onChange={(e) => setDraft({ ad_campaign_id: e.target.value })}
            >
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW_CAMPAIGN}>Create a new campaign automatically</option>
            </Select>
          </Field>
        </Row>
      )}
    </div>
  );
}
