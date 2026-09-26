import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { InventorySettings, PlatformLocationDefault, StockLocation } from "@/types";
import { createTenantClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/utils/fetchAllRows";
import { inventoryErrorMessage } from "@/lib/inventory/inventoryErrors";

/**
 * Batches & locations settings for the Inventory page (Business/trial only).
 * Loaded on demand by the Inventory page — not by dashboard/layout.tsx — so
 * no other page and no Starter/Pro tenant pays for these queries.
 */

/** stock_locations grows with the tenant (user-created), so it is read with fetchAllRows. */
export const STOCK_LOCATIONS_CAP = 1000;

const LOAD_ERROR = "Could not load batches & locations.";

interface AdvancedInventoryState {
  settings: InventorySettings | null;
  locations: StockLocation[];
  platformDefaults: PlatformLocationDefault[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: AdvancedInventoryState = {
  settings: null,
  locations: [],
  platformDefaults: [],
  loaded: false,
  loading: false,
  error: null,
};

export const fetchAdvancedInventory = createAsyncThunk(
  "advancedInventory/fetch",
  async () => {
    const supabase = await createTenantClient();
    const [settingsRes, defaultsRes, locations] = await Promise.all([
      // Singleton row (primary key id = true).
      supabase
        .from("inventory_settings")
        .select("advanced_enabled, enabled_at, default_location_id")
        .maybeSingle<InventorySettings>(),
      // Structurally bounded: platform is the primary key, one row per Platform (5 max).
      supabase.from("platform_location_defaults").select("platform, location_id").returns<PlatformLocationDefault[]>(),
      fetchAllRows<StockLocation>(
        async (from, to) =>
          await supabase
            .from("stock_locations")
            .select("*", { count: "exact" })
            .order("name", { ascending: true })
            .range(from, to),
        STOCK_LOCATIONS_CAP
      ),
    ]);
    if (settingsRes.error) throw new Error(inventoryErrorMessage(settingsRes.error, LOAD_ERROR));
    if (defaultsRes.error) throw new Error(inventoryErrorMessage(defaultsRes.error, LOAD_ERROR));
    return {
      settings: settingsRes.data,
      locations,
      platformDefaults: defaultsRes.data || [],
    };
  }
);

export const advancedInventorySlice = createSlice({
  name: "advancedInventory",
  initialState,
  reducers: {
    locationSaved(state, action: PayloadAction<StockLocation>) {
      const idx = state.locations.findIndex((l) => l.id === action.payload.id);
      if (idx === -1) state.locations.push(action.payload);
      else state.locations[idx] = action.payload;
    },
    locationRemoved(state, action: PayloadAction<string>) {
      state.locations = state.locations.filter((l) => l.id !== action.payload);
    },
    settingsSet(state, action: PayloadAction<InventorySettings>) {
      state.settings = action.payload;
    },
    platformDefaultsMerged(state, action: PayloadAction<PlatformLocationDefault[]>) {
      for (const row of action.payload) {
        const idx = state.platformDefaults.findIndex((d) => d.platform === row.platform);
        if (idx === -1) state.platformDefaults.push(row);
        else state.platformDefaults[idx] = row;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdvancedInventory.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAdvancedInventory.fulfilled, (state, action) => {
        state.settings = action.payload.settings;
        state.locations = action.payload.locations;
        state.platformDefaults = action.payload.platformDefaults;
        state.loaded = true;
        state.loading = false;
        state.error = null;
      })
      .addCase(fetchAdvancedInventory.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || LOAD_ERROR;
      });
  },
});

export const { locationSaved, locationRemoved, settingsSet, platformDefaultsMerged } =
  advancedInventorySlice.actions;
