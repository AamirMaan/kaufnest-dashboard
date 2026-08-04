import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import { createTenantClient } from "@/lib/supabase/client";
import { isSynthetic, type LowStockProduct } from "@/lib/utils/notifications";
import type { Notification } from "@/types";

interface NotificationsState {
  items: Notification[];
  /** Ids dismissed individually, after the bulk watermark. */
  readIds: string[];
  /** Bulk "mark all read" watermark. */
  readThrough: string | null;
  /** Products with a threshold set; low stock is derived from these on read. */
  lowStock: LowStockProduct[];
  loaded: boolean;
  isFetching: boolean;
}

const initialState: NotificationsState = {
  items: [],
  readIds: [],
  readThrough: null,
  lowStock: [],
  loaded: false,
  isFetching: false,
};

/**
 * RLS does the filtering — this deliberately has no role/permission logic.
 * Whatever Postgres returns is exactly what this user is allowed to see.
 *
 * All THREE pieces of read state must be fetched together. Fetching only the
 * notifications would leave `readThrough`/`readIds` empty, so every poll would
 * re-count read items as unread and silently undo "mark all read".
 * `notification_reads` is already scoped to the current user by RLS.
 */
export const fetchNotifications = createAsyncThunk(
  "notifications/fetch",
  async ({ userId, limit = 30 }: { userId: string; limit?: number }) => {
    const supabase = await createTenantClient();

    const [notifs, reads, profile, products] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase.from("notification_reads").select("notification_id"),
      supabase
        .from("profiles")
        .select("notifications_read_through")
        .eq("id", userId)
        .single(),
      // Low stock is a STATE, evaluated on read rather than stored. PostgREST
      // cannot compare two columns, so fetch everything with a threshold set
      // and let synthesizeLowStock() apply the comparison.
      supabase
        .from("products")
        .select("id, name, sku, current_stock, reorder_threshold")
        .not("reorder_threshold", "is", null),
    ]);

    if (notifs.error) throw notifs.error;
    if (reads.error) throw reads.error;
    if (profile.error) throw profile.error;
    if (products.error) throw products.error;

    return {
      data: (notifs.data ?? []) as Notification[],
      readIds: (reads.data ?? []).map((r) => r.notification_id as string),
      readThrough: (profile.data?.notifications_read_through ?? null) as string | null,
      lowStock: (products.data ?? []) as LowStockProduct[],
    };
  },
);

export const notificationsSlice = createSlice({
  name: "notifications",
  initialState,
  reducers: {
    hydrateNotifications: (
      state,
      action: PayloadAction<{ data: Notification[]; readThrough: string | null; readIds: string[] }>,
    ) => {
      state.items = action.payload.data;
      state.readThrough = action.payload.readThrough;
      state.readIds = action.payload.readIds;
      state.loaded = true;
      state.isFetching = false;
    },
    markAllRead: (state, action: PayloadAction<string>) => {
      state.readThrough = action.payload;
      // Per-id dismissals before the watermark are now redundant.
      state.readIds = [];
    },
    dismissOne: (state, action: PayloadAction<string>) => {
      // Synthesized low-stock items are not database rows — writing their id to
      // notification_reads would violate its FK to notifications.id. They clear
      // when stock recovers, not when dismissed.
      if (isSynthetic(action.payload)) return;
      if (!state.readIds.includes(action.payload)) state.readIds.push(action.payload);
    },
    setFetching: (state, action: PayloadAction<boolean>) => {
      state.isFetching = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchNotifications.pending, (state) => { state.isFetching = true; })
      .addCase(fetchNotifications.fulfilled, (state, action) => {
        state.items = action.payload.data;
        state.readIds = action.payload.readIds;
        state.readThrough = action.payload.readThrough;
        state.loaded = true;
        state.isFetching = false;
      })
      .addCase(fetchNotifications.rejected, (state) => { state.isFetching = false; });
  },
});

export const { hydrateNotifications, markAllRead, dismissOne, setFetching } =
  notificationsSlice.actions;
