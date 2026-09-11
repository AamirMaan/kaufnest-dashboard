// eBay Marketing API — Promoted Listings (cost-per-sale ads) and item
// promotions (multi-buy volume discounts). Server-only, like the rest of
// src/lib/integrations/. Needs the sell.marketing OAuth scope: a connection
// authorised before that scope was added gets 403 here until the tenant
// disconnects and reconnects eBay (see src/lib/integrations/SKILL.md).
import type { EbayListingDraft } from "@/types";
import type { IntegrationAuthContext } from "../authGuard";
import { ebayFetch, throwIfNotOk, MARKETPLACE_ID } from "./publish";
import {
  buildAdPayload,
  buildCampaignPayload,
  buildVolumeDiscountPayload,
  multiBuyTiersFromDraft,
  type MultiBuyTiers,
} from "./publishPayloads";

export const RECONNECT_MESSAGE =
  "Your eBay connection doesn't allow advertising or multi-buy discounts yet. Disconnect and reconnect eBay in Integrations, then retry.";

export interface CampaignSummary {
  id: string;
  name: string;
}

export interface RawCampaign {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  marketplaceId: string;
  fundingStrategy?: { fundingModel?: string };
  campaignCriterion?: { selectionRules?: unknown[] } | null;
}

const USABLE_STATUSES = new Set(["RUNNING", "SCHEDULED"]);

// Only campaigns a listing can be added to by hand: cost-per-sale, still
// running (or about to), on our marketplace, and NOT rules-based — eBay
// rejects manually added ads on a campaign that selects listings by rules.
export function filterManualCampaigns(
  campaigns: RawCampaign[],
  marketplaceId: string
): CampaignSummary[] {
  return campaigns
    .filter(
      (c) =>
        USABLE_STATUSES.has(c.campaignStatus) &&
        c.marketplaceId === marketplaceId &&
        c.fundingStrategy?.fundingModel === "COST_PER_SALE" &&
        !(c.campaignCriterion?.selectionRules?.length)
    )
    .map((c) => ({ id: c.campaignId, name: c.campaignName }));
}

/** eBay's create calls answer 201 with the new resource's URL in `Location`. */
export function idFromLocation(location: string | null): string {
  const id = location?.split("/").filter(Boolean).pop();
  if (!id) throw new Error("eBay did not return the new resource's id.");
  return id;
}

async function throwIfMarketingNotOk(res: Response, action: string): Promise<void> {
  if (res.status === 403) throw new Error(RECONNECT_MESSAGE);
  await throwIfNotOk(res, action);
}

export async function fetchManualCampaigns(
  accessToken: string
): Promise<{ campaigns: CampaignSummary[]; needsReconnect: boolean }> {
  const params = new URLSearchParams({
    campaign_status: "RUNNING,SCHEDULED",
    funding_strategy: "COST_PER_SALE",
    limit: "100",
  });
  const res = await ebayFetch(`/sell/marketing/v1/ad_campaign?${params.toString()}`, accessToken);
  // We don't store granted scopes, and eBay's token response doesn't list
  // them — a 403 here IS the "reconnect to grant sell.marketing" signal.
  if (res.status === 403) return { campaigns: [], needsReconnect: true };
  if (res.status === 204) return { campaigns: [], needsReconnect: false };
  await throwIfNotOk(res, "getCampaigns");
  const json = (await res.json()) as { campaigns?: RawCampaign[] };
  return {
    campaigns: filterManualCampaigns(json.campaigns ?? [], MARKETPLACE_ID),
    needsReconnect: false,
  };
}

export interface MarketingApi {
  createCampaign(rate: number): Promise<string>;
  addListingToCampaign(campaignId: string, listingId: string, rate: number): Promise<string>;
  createVolumeDiscount(listingId: string, tiers: MultiBuyTiers): Promise<string>;
}

export function createMarketingApi(accessToken: string): MarketingApi {
  return {
    async createCampaign(rate) {
      const res = await ebayFetch("/sell/marketing/v1/ad_campaign", accessToken, {
        method: "POST",
        body: JSON.stringify(buildCampaignPayload(MARKETPLACE_ID, new Date(), rate)),
      });
      await throwIfMarketingNotOk(res, "createCampaign");
      return idFromLocation(res.headers.get("Location"));
    },
    async addListingToCampaign(campaignId, listingId, rate) {
      const res = await ebayFetch(
        `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/ad`,
        accessToken,
        { method: "POST", body: JSON.stringify(buildAdPayload(listingId, rate)) }
      );
      await throwIfMarketingNotOk(res, "createAdByListingId");
      return idFromLocation(res.headers.get("Location"));
    },
    async createVolumeDiscount(listingId, tiers) {
      const res = await ebayFetch("/sell/marketing/v1/item_promotion", accessToken, {
        method: "POST",
        body: JSON.stringify(
          buildVolumeDiscountPayload(listingId, tiers, MARKETPLACE_ID, new Date())
        ),
      });
      await throwIfMarketingNotOk(res, "createItemPromotion");
      return idFromLocation(res.headers.get("Location"));
    },
  };
}

export type MarketingPatch = Partial<
  Pick<EbayListingDraft, "ad_campaign_id" | "ebay_ad_id" | "ebay_promotion_id" | "marketing_error">
>;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Post-publish marketing for one live listing. Each step persists the id
 * eBay returns the moment it has it, and is skipped when that id is already
 * stored — so running this twice (the apply-marketing retry) can never
 * create a duplicate ad or promotion. The two steps are independent: one
 * failing never skips the other. Never throws — the listing is already
 * live, and every failure comes back as a warning string.
 */
export async function runMarketingSteps(
  draft: EbayListingDraft,
  listingId: string,
  api: MarketingApi,
  persist: (patch: MarketingPatch) => Promise<void>
): Promise<string[]> {
  const warnings: string[] = [];

  if (draft.ad_rate != null && !draft.ebay_ad_id) {
    try {
      let campaignId = draft.ad_campaign_id;
      if (!campaignId) {
        campaignId = await api.createCampaign(draft.ad_rate);
        // Saved before the ad call: if that call fails, the retry reuses this
        // campaign instead of creating a second one.
        await persist({ ad_campaign_id: campaignId });
      }
      const adId = await api.addListingToCampaign(campaignId, listingId, draft.ad_rate);
      await persist({ ebay_ad_id: adId });
    } catch (err) {
      warnings.push(`The ad couldn't be added: ${messageOf(err)}`);
    }
  }

  const tiers = multiBuyTiersFromDraft(draft);
  if (tiers && !draft.ebay_promotion_id) {
    try {
      const promotionId = await api.createVolumeDiscount(listingId, tiers);
      await persist({ ebay_promotion_id: promotionId });
    } catch (err) {
      warnings.push(`The multi-buy discount couldn't be created: ${messageOf(err)}`);
    }
  }

  const nextError = warnings.length > 0 ? warnings.join(" ") : null;
  if (nextError !== draft.marketing_error) {
    try {
      await persist({ marketing_error: nextError });
    } catch (err) {
      console.error("[ebay/marketing] could not save marketing_error:", messageOf(err));
    }
  }

  return warnings;
}

/** Route-side wrapper: runs the steps against eBay and returns the fresh row. */
export async function applyMarketingToDraft(
  client: IntegrationAuthContext["client"],
  draft: EbayListingDraft,
  accessToken: string
): Promise<{ draft: EbayListingDraft; warnings: string[] }> {
  if (!draft.ebay_listing_id) return { draft, warnings: [] };

  const persist = async (patch: MarketingPatch) => {
    const { error } = await client.from("ebay_listing_drafts").update(patch).eq("id", draft.id);
    if (error) throw new Error("Could not save eBay's response to this listing.");
  };

  const warnings = await runMarketingSteps(
    draft,
    draft.ebay_listing_id,
    createMarketingApi(accessToken),
    persist
  );

  const { data } = await client
    .from("ebay_listing_drafts")
    .select("*")
    .eq("id", draft.id)
    .single<EbayListingDraft>();

  return { draft: data ?? draft, warnings };
}
