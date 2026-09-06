import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationPlatform } from "@/types";

/**
 * `tokenStore`/`sync` accept both `createClient()`'s tenant-scoped server
 * client and `createServiceClientForTenant()`'s service-role client — these
 * resolve to different `SupabaseClient<...>` schema-generic instantiations,
 * so callers are typed against just the subset of the client surface
 * (`from`) that both share and that this library actually uses.
 */
export type IntegrationsClient = Pick<SupabaseClient, "from">;

export interface ShippingAddress {
  buyerName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * Platform-agnostic order shape returned by each adapter's `fetchOrders`.
 * One `NormalizedOrder` maps to one `sales` row via `mapToSale.ts` — for
 * platforms that return multiple line items per order, the adapter emits one
 * `NormalizedOrder` per line item and gives each a distinct
 * `external_order_id` (e.g. `${orderId}:${lineItemId}`) so the
 * `(platform, external_order_id)` unique index stays one-row-per-line-item.
 */
export interface NormalizedOrder {
  external_order_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  currency: string;
  date: string; // ISO date (YYYY-MM-DD)
  status: string;
  description: string | null;
  /**
   * Buyer shipping address, when the platform's order API returns one.
   * `undefined` (not set) when the adapter doesn't support it (Amazon) —
   * distinct from `null`, which means "asked and the platform had none".
   */
  shipping?: ShippingAddress | null;
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  /** ISO timestamp */
  expires_at: string;
}

export interface ExchangeCodeResult extends TokenSet {
  /** Seller's account id on the platform (eBay username, Amazon selling partner id) */
  externalAccountId?: string;
  /** Amazon marketplace id from the OAuth redirect; eBay adapters leave this undefined */
  marketplaceId?: string;
}

export interface PlatformAdapter {
  platform: IntegrationPlatform;
  /** Build the provider's OAuth consent-screen URL for this `state` nonce. */
  getAuthUrl(state: string): string;
  /** Exchange an OAuth `code` (from the callback redirect) for tokens. */
  exchangeCode(code: string): Promise<ExchangeCodeResult>;
  /** Exchange a refresh token for a new access token. */
  refreshAccessToken(refreshToken: string): Promise<TokenSet>;
  /** Fetch orders created/updated since `sinceISO`. */
  fetchOrders(
    accessToken: string,
    sinceISO: string,
    marketplaceId: string | null
  ): Promise<NormalizedOrder[]>;
}

export interface SyncResult {
  ok: boolean;
  synced: number;
  error?: string;
}
