import { resolveCampaignSelection } from "./campaignSelection";
import { NEW_CAMPAIGN } from "./wizardValidation";

const campaigns = [
  { id: "c-1", name: "Campaign 13.05.2026 17:18:00" },
  { id: "c-2", name: "Summer" },
];

describe("resolveCampaignSelection", () => {
  it("keeps a campaign that is still in the list", () => {
    expect(resolveCampaignSelection("c-2", campaigns)).toBe("c-2");
  });

  it("keeps an explicit auto-create choice even when campaigns exist", () => {
    expect(resolveCampaignSelection(NEW_CAMPAIGN, campaigns)).toBe(NEW_CAMPAIGN);
  });

  it("falls back to the first campaign when nothing is chosen", () => {
    expect(resolveCampaignSelection("", campaigns)).toBe("c-1");
  });

  it("replaces a campaign that has since ended", () => {
    expect(resolveCampaignSelection("gone", campaigns)).toBe("c-1");
  });

  it("falls back to auto-create when the seller has no campaigns", () => {
    expect(resolveCampaignSelection("", [])).toBe(NEW_CAMPAIGN);
  });
});
