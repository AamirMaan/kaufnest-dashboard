import { NEW_CAMPAIGN } from "./wizardValidation";

/** Client-side copy of the campaigns route's item shape (lib/integrations is server-only). */
export interface CampaignOption {
  id: string;
  name: string;
}

/**
 * What the campaign dropdown should hold once the list has loaded: a valid
 * current choice stays (a campaign still in the list, or the explicit
 * auto-create option); otherwise the first campaign, or auto-create when the
 * seller has none. Defaulting to an existing campaign rather than
 * auto-create keeps each new listing from spawning its own campaign.
 */
export function resolveCampaignSelection(current: string, campaigns: CampaignOption[]): string {
  if (current === NEW_CAMPAIGN) return current;
  if (campaigns.some((c) => c.id === current)) return current;
  return campaigns[0]?.id ?? NEW_CAMPAIGN;
}
