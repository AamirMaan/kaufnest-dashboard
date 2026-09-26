import {
  advancedInventoryView,
  sortLocations,
  defaultLocationOptions,
  platformLocationOptions,
  isLocationNameTaken,
  locationDeactivationBlocker,
  fulfillmentDraftFrom,
  platformDefaultChanges,
  isFulfillmentDraftValid,
  isFulfillmentDraftDirty,
  INVENTORY_PLATFORMS,
  LOCATION_TYPE_LABELS,
} from "./advancedInventory";
import type { InventorySettings, PlatformLocationDefault, StockLocation } from "@/types";

const loc = (id: string, overrides: Partial<StockLocation> = {}): StockLocation => ({
  id,
  name: id.toUpperCase(),
  type: "own",
  is_active: true,
  created_by: null,
  created_at: "2026-09-26T00:00:00.000Z",
  ...overrides,
});

const settings = (overrides: Partial<InventorySettings> = {}): InventorySettings => ({
  advanced_enabled: true,
  enabled_at: "2026-09-26T00:00:00.000Z",
  default_location_id: "main",
  ...overrides,
});

const allDefaults = (locationId: string): PlatformLocationDefault[] =>
  INVENTORY_PLATFORMS.map((platform) => ({ platform, location_id: locationId }));

describe("advancedInventoryView", () => {
  const idle = { loaded: false, loading: false, error: null, settings: null };

  it("shows the upsell for plans without advanced inventory, and when the plan is unknown", () => {
    expect(advancedInventoryView("starter", idle)).toBe("upsell");
    expect(advancedInventoryView("pro", { ...idle, loaded: true, settings: settings() })).toBe("upsell");
    expect(advancedInventoryView(null, idle)).toBe("upsell");
  });

  it("is loading until the first fetch completes", () => {
    expect(advancedInventoryView("business", idle)).toBe("loading");
    expect(advancedInventoryView("business", { ...idle, loading: true })).toBe("loading");
  });

  it("reports a load error", () => {
    expect(advancedInventoryView("business", { ...idle, error: "boom" })).toBe("error");
  });

  it("offers enabling when the flag is off or the settings row is missing", () => {
    expect(advancedInventoryView("business", { ...idle, loaded: true, settings: settings({ advanced_enabled: false }) })).toBe("enable");
    expect(advancedInventoryView("trial", { ...idle, loaded: true, settings: null })).toBe("enable");
  });

  it("is active once enabled on business or trial", () => {
    expect(advancedInventoryView("business", { ...idle, loaded: true, settings: settings() })).toBe("active");
    expect(advancedInventoryView("trial", { ...idle, loaded: true, settings: settings() })).toBe("active");
  });
});

describe("sortLocations", () => {
  it("puts active locations first, then sorts by name case-insensitively", () => {
    const sorted = sortLocations([
      loc("b", { name: "beta" }),
      loc("z", { name: "Alpha", is_active: false }),
      loc("a", { name: "Amazon FBA" }),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(["a", "b", "z"]);
  });

  it("does not mutate its input", () => {
    const input = [loc("b", { name: "B" }), loc("a", { name: "A" })];
    sortLocations(input);
    expect(input.map((l) => l.id)).toEqual(["b", "a"]);
  });
});

describe("defaultLocationOptions", () => {
  it("keeps only active, stock-holding locations", () => {
    const options = defaultLocationOptions([
      loc("main"),
      loc("ds", { type: "dropship" }),
      loc("old", { is_active: false }),
      loc("fba", { type: "fba", name: "Amazon FBA" }),
    ]);
    expect(options.map((l) => l.id)).toEqual(["fba", "main"]);
  });
});

describe("platformLocationOptions", () => {
  it("offers active locations of any type, plus the currently selected one even if inactive", () => {
    const locations = [loc("main"), loc("ds", { type: "dropship" }), loc("old", { is_active: false })];
    expect(platformLocationOptions(locations, null).map((l) => l.id)).toEqual(["ds", "main"]);
    expect(platformLocationOptions(locations, "old").map((l) => l.id)).toEqual(["ds", "main", "old"]);
  });
});

describe("isLocationNameTaken", () => {
  const locations = [loc("main", { name: "Main" }), loc("fba", { name: "Amazon FBA" })];

  it("matches trimmed names case-insensitively", () => {
    expect(isLocationNameTaken("  main ", locations)).toBe(true);
    expect(isLocationNameTaken("Warehouse 2", locations)).toBe(false);
  });

  it("ignores the location being edited", () => {
    expect(isLocationNameTaken("Main", locations, "main")).toBe(false);
  });
});

describe("locationDeactivationBlocker", () => {
  it("blocks deactivating the default location", () => {
    expect(locationDeactivationBlocker(loc("main"), settings(), [])).toBe(
      "This is the default location. Choose another default location first.",
    );
  });

  it("blocks deactivating a platform's default location (singular copy)", () => {
    expect(
      locationDeactivationBlocker(loc("fba"), settings(), [{ platform: "amazon", location_id: "fba" }]),
    ).toBe("This location is the default for Amazon. Choose another location for that platform first.");
  });

  it("blocks deactivating a platform's default location (plural copy, INVENTORY_PLATFORMS order)", () => {
    expect(
      locationDeactivationBlocker(loc("fba"), settings(), [
        { platform: "ebay", location_id: "fba" },
        { platform: "amazon", location_id: "fba" },
      ]),
    ).toBe("This location is the default for Amazon, eBay. Choose another location for those platforms first.");
  });

  it("the tenant-default message wins when a location is both the tenant default and a platform default", () => {
    expect(
      locationDeactivationBlocker(loc("main"), settings(), [{ platform: "amazon", location_id: "main" }]),
    ).toBe("This is the default location. Choose another default location first.");
  });

  it("allows any other location, and allows reactivation even if it is still a platform default", () => {
    expect(locationDeactivationBlocker(loc("fba"), settings(), [])).toBeNull();
    expect(locationDeactivationBlocker(loc("main", { is_active: false }), settings(), [])).toBeNull();
    expect(
      locationDeactivationBlocker(loc("fba", { is_active: false }), settings(), [
        { platform: "amazon", location_id: "fba" },
      ]),
    ).toBeNull();
  });
});

describe("fulfillment defaults draft", () => {
  const locations = [loc("main"), loc("fba", { type: "fba" }), loc("ds", { type: "dropship" })];

  it("builds a draft from settings and platform defaults, blank for unmapped platforms", () => {
    const draft = fulfillmentDraftFrom(settings(), [{ platform: "amazon", location_id: "fba" }]);
    expect(draft.defaultLocationId).toBe("main");
    expect(draft.platforms.amazon).toBe("fba");
    expect(draft.platforms.ebay).toBe("");
  });

  it("lists only changed platform rows", () => {
    const current = allDefaults("main");
    const draft = fulfillmentDraftFrom(settings(), current);
    draft.platforms.amazon = "fba";
    draft.platforms.other = "ds";
    expect(platformDefaultChanges(current, draft)).toEqual([
      { platform: "amazon", location_id: "fba" },
      { platform: "other", location_id: "ds" },
    ]);
  });

  it("is valid when the default is an active stock-holding location and every platform is mapped", () => {
    const draft = fulfillmentDraftFrom(settings(), allDefaults("main"));
    expect(isFulfillmentDraftValid(draft, locations)).toBe(true);
    draft.platforms.etsy = "ds";
    expect(isFulfillmentDraftValid(draft, locations)).toBe(true);
  });

  it("is invalid with a dropship default or an unmapped platform", () => {
    const draft = fulfillmentDraftFrom(settings({ default_location_id: "ds" }), allDefaults("main"));
    expect(isFulfillmentDraftValid(draft, locations)).toBe(false);
    const draft2 = fulfillmentDraftFrom(settings(), allDefaults("main"));
    draft2.platforms.shopify = "";
    expect(isFulfillmentDraftValid(draft2, locations)).toBe(false);
  });

  it("detects whether anything changed", () => {
    const current = allDefaults("main");
    const draft = fulfillmentDraftFrom(settings(), current);
    expect(isFulfillmentDraftDirty(settings(), current, draft)).toBe(false);
    draft.defaultLocationId = "fba";
    expect(isFulfillmentDraftDirty(settings(), current, draft)).toBe(true);
  });
});

describe("labels", () => {
  it("labels every location type", () => {
    expect(LOCATION_TYPE_LABELS).toEqual({
      own: "Own warehouse",
      fba: "Amazon FBA",
      "3pl": "3PL warehouse",
      dropship: "Dropship supplier",
    });
  });
});
