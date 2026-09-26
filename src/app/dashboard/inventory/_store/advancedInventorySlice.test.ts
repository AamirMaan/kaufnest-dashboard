import {
  advancedInventorySlice,
  fetchAdvancedInventory,
  locationSaved,
  locationRemoved,
  settingsSet,
  platformDefaultsMerged,
  isAdvancedInventoryFresh,
  ADVANCED_INVENTORY_STALE_MS,
} from "./advancedInventorySlice";
import type { InventorySettings, StockLocation } from "@/types";

const { reducer } = advancedInventorySlice;

const loc = (id: string, overrides: Partial<StockLocation> = {}): StockLocation => ({
  id,
  name: id,
  type: "own",
  is_active: true,
  created_by: null,
  created_at: "2026-09-26T00:00:00.000Z",
  ...overrides,
});

const settings: InventorySettings = {
  advanced_enabled: true,
  enabled_at: "2026-09-26T00:00:00.000Z",
  default_location_id: "main",
};

describe("advancedInventorySlice", () => {
  it("starts empty and not loaded", () => {
    expect(reducer(undefined, { type: "@@INIT" })).toEqual({
      settings: null,
      locations: [],
      platformDefaults: [],
      loaded: false,
      loading: false,
      error: null,
      loadedAt: null,
    });
  });

  it("tracks the fetch lifecycle", () => {
    const pending = reducer(undefined, { type: fetchAdvancedInventory.pending.type });
    expect(pending.loading).toBe(true);
    expect(pending.error).toBeNull();

    const payload = {
      settings,
      locations: [loc("main")],
      platformDefaults: [{ platform: "ebay", location_id: "main" }],
      loadedAt: 1_700_000_000_000,
    };
    const done = reducer(pending, { type: fetchAdvancedInventory.fulfilled.type, payload });
    expect(done).toEqual({ ...payload, loaded: true, loading: false, error: null });
  });

  it("keeps loaded data when a refresh is rejected", () => {
    const loaded = reducer(undefined, {
      type: fetchAdvancedInventory.fulfilled.type,
      payload: { settings, locations: [loc("main")], platformDefaults: [], loadedAt: 1 },
    });
    const failed = reducer(loaded, { type: fetchAdvancedInventory.rejected.type, error: { message: "offline" } });
    expect(failed.loaded).toBe(true);
    expect(failed.locations).toHaveLength(1);
    expect(failed.error).toBe("offline");
  });

  it("stores the rejection message and clears loading", () => {
    const pending = reducer(undefined, { type: fetchAdvancedInventory.pending.type });
    const failed = reducer(pending, {
      type: fetchAdvancedInventory.rejected.type,
      error: { message: "Could not load batches & locations." },
    });
    expect(failed.loading).toBe(false);
    expect(failed.loaded).toBe(false);
    expect(failed.error).toBe("Could not load batches & locations.");
  });

  it("falls back to a generic error when the rejection has no message", () => {
    const failed = reducer(undefined, { type: fetchAdvancedInventory.rejected.type, error: {} });
    expect(failed.error).toBe("Could not load batches & locations.");
  });

  it("inserts a new location and replaces an edited one", () => {
    let state = reducer(undefined, locationSaved(loc("main")));
    state = reducer(state, locationSaved(loc("fba", { type: "fba" })));
    state = reducer(state, locationSaved(loc("main", { name: "Main warehouse" })));
    expect(state.locations.map((l) => [l.id, l.name])).toEqual([
      ["main", "Main warehouse"],
      ["fba", "fba"],
    ]);
  });

  it("removes a location", () => {
    const state = reducer(reducer(undefined, locationSaved(loc("main"))), locationRemoved("main"));
    expect(state.locations).toEqual([]);
  });

  it("replaces settings", () => {
    const state = reducer(undefined, settingsSet(settings));
    expect(state.settings).toEqual(settings);
  });

  it("merges platform defaults by platform", () => {
    let state = reducer(undefined, platformDefaultsMerged([
      { platform: "ebay", location_id: "main" },
      { platform: "amazon", location_id: "main" },
    ]));
    state = reducer(state, platformDefaultsMerged([{ platform: "amazon", location_id: "fba" }]));
    expect(state.platformDefaults).toEqual([
      { platform: "ebay", location_id: "main" },
      { platform: "amazon", location_id: "fba" },
    ]);
  });
});

describe("isAdvancedInventoryFresh", () => {
  it("is fresh only within the stale window after a load", () => {
    expect(isAdvancedInventoryFresh(null, 1_000)).toBe(false);
    expect(isAdvancedInventoryFresh(1_000, 1_000 + ADVANCED_INVENTORY_STALE_MS - 1)).toBe(true);
    expect(isAdvancedInventoryFresh(1_000, 1_000 + ADVANCED_INVENTORY_STALE_MS)).toBe(false);
  });
});
