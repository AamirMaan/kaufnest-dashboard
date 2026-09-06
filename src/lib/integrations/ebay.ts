import type { NormalizedOrder, PlatformAdapter, ShippingAddress, TokenSet } from "./types";

const SANDBOX = process.env.EBAY_SANDBOX === "true";
const EBAY_BASE = SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const EBAY_AUTH_URL = SANDBOX
  ? "https://auth.sandbox.ebay.com/oauth2/authorize"
  : "https://auth.ebay.com/oauth2/authorize";
const EBAY_TOKEN_URL = `${EBAY_BASE}/identity/v1/oauth2/token`;
const EBAY_ORDERS_URL = `${EBAY_BASE}/sell/fulfillment/v1/order`;
// sell.inventory (full, not .readonly) is required for Trading API calls
// (GetMyeBaySelling in listings.ts). sell.account is required for the
// Business Policies endpoints (fetchBusinessPolicies in publish.ts —
// /sell/account/v1/{fulfillment,payment,return}_policy), which 403 with
// errorId 1100 ("Insufficient permissions") without it. Connections
// authorised before either scope was added must be disconnected and
// reconnected — a code deploy alone does not retroactively grant scopes to
// an already-issued token/refresh-token pair.
const EBAY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment" +
  " https://api.ebay.com/oauth/api_scope/sell.inventory" +
  " https://api.ebay.com/oauth/api_scope/sell.account";

interface EbayTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface EbayMoney {
  value: string;
  currency: string;
}

interface EbayLineItem {
  lineItemId: string;
  title: string;
  quantity: string | number;
  total?: EbayMoney;
}

interface EbayContactAddress {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  countryCode?: string;
}

interface EbayShipTo {
  fullName?: string;
  contactAddress?: EbayContactAddress;
  primaryPhone?: { phoneNumber?: string };
  email?: string;
}

interface EbayFulfillmentStartInstruction {
  shippingStep?: {
    shipTo?: EbayShipTo;
  };
}

interface EbayOrder {
  orderId: string;
  creationDate?: string;
  orderFulfillmentStatus?: string;
  orderPaymentStatus?: string;
  lineItems?: EbayLineItem[];
  fulfillmentStartInstructions?: EbayFulfillmentStartInstruction[];
}

interface EbayOrdersResponse {
  orders?: EbayOrder[];
}

function basicAuthHeader(): string {
  const credentials = `${process.env.EBAY_CLIENT_ID ?? ""}:${process.env.EBAY_CLIENT_SECRET ?? ""}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

async function requestToken(body: URLSearchParams): Promise<TokenSet> {
  const res = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`eBay token request failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as EbayTokenResponse;
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? "",
    expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}

/** Maps eBay's fulfillment/payment status pair onto the Sales feature's status vocabulary. */
function mapStatus(fulfillmentStatus: string | undefined, paymentStatus: string | undefined): string {
  if (paymentStatus === "FULLY_REFUNDED" || paymentStatus === "PARTIALLY_REFUNDED") return "returned";
  switch (fulfillmentStatus) {
    case "FULFILLED":
      return "delivered";
    case "IN_PROGRESS":
      return "processing";
    default:
      return "pending";
  }
}

/**
 * eBay orders in this app's flow are single-shipment — there is no
 * per-line-item address, so this reads the FIRST fulfillmentStartInstruction's
 * shipTo and the caller attaches the result to every line item's
 * NormalizedOrder (same as date/description). Returns null (not undefined)
 * when eBay's response has no fulfillmentStartInstructions/shipTo, per the
 * NormalizedOrder.shipping contract: null means "asked, platform had none".
 */
function extractShippingAddress(order: EbayOrder): ShippingAddress | null {
  const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  if (!shipTo) return null;

  const address = shipTo.contactAddress;
  return {
    buyerName: shipTo.fullName ?? null,
    addressLine1: address?.addressLine1 ?? null,
    addressLine2: address?.addressLine2 ?? null,
    city: address?.city ?? null,
    state: address?.stateOrProvince ?? null,
    postalCode: address?.postalCode ?? null,
    country: address?.countryCode ?? null,
    phone: shipTo.primaryPhone?.phoneNumber ?? null,
    email: shipTo.email ?? null,
  };
}

export const ebayAdapter: PlatformAdapter = {
  platform: "ebay",

  getAuthUrl(state) {
    const params = new URLSearchParams({
      client_id: process.env.EBAY_CLIENT_ID ?? "",
      redirect_uri: process.env.EBAY_RU_NAME ?? "",
      response_type: "code",
      scope: EBAY_SCOPE,
      state,
    });
    return `${EBAY_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code) {
    return requestToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.EBAY_RU_NAME ?? "",
      })
    );
  },

  async refreshAccessToken(refreshToken) {
    return requestToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        // Omitting scope lets eBay use the original grant's scopes.
        // Passing EBAY_SCOPE here causes invalid_scope for connections
        // that pre-date the sell.inventory.readonly scope addition.
      })
    );
  },

  async fetchOrders(accessToken, sinceISO) {
    const filter = `creationdate:[${sinceISO}..]`;
    const params = new URLSearchParams({ filter, limit: "50" });
    const res = await fetch(`${EBAY_ORDERS_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`eBay orders request failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as EbayOrdersResponse;
    const orders: NormalizedOrder[] = [];

    for (const order of json.orders ?? []) {
      const status = mapStatus(order.orderFulfillmentStatus, order.orderPaymentStatus);
      const date = (order.creationDate ?? new Date().toISOString()).slice(0, 10);
      const shipping = extractShippingAddress(order);

      for (const item of order.lineItems ?? []) {
        const quantity = Number(item.quantity) || 1;
        const totalAmount = Number(item.total?.value ?? 0);

        orders.push({
          external_order_id: `${order.orderId}:${item.lineItemId}`,
          product_name: item.title ?? "eBay order",
          quantity,
          unit_price: Math.round((totalAmount / quantity) * 100) / 100,
          total_amount: totalAmount,
          currency: item.total?.currency ?? "EUR",
          date,
          status,
          description: `eBay order ${order.orderId}`,
          shipping,
        });
      }
    }

    return orders;
  },
};

export interface CreateShippingFulfillmentBody {
  lineItems: { lineItemId: string; quantity: number }[];
  shippedDate: string;
  shippingCarrierCode: string;
  trackingNumber: string;
}

export interface CreateShippingFulfillmentResult {
  fulfillmentId: string;
}

/**
 * POSTs a shipping fulfillment for an eBay order — marks it shipped on
 * eBay's side. `orderId` is the eBay order id parsed out of
 * `sales.external_order_id` by the sync-status route. Throws on any
 * non-OK response or a 2xx response with no `fulfillmentId`.
 */
export async function createShippingFulfillment(
  accessToken: string,
  orderId: string,
  body: CreateShippingFulfillmentBody
): Promise<CreateShippingFulfillmentResult> {
  const res = await fetch(`${EBAY_ORDERS_URL}/${orderId}/shipping_fulfillment`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`eBay createShippingFulfillment failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { fulfillmentId?: string };
  if (!json.fulfillmentId) {
    throw new Error("eBay createShippingFulfillment succeeded but returned no fulfillmentId");
  }
  return { fulfillmentId: json.fulfillmentId };
}

export interface CancelOrderBody {
  cancelReason?: string;
}

export interface CancelOrderResult {
  cancelId?: string;
}

/**
 * POSTs an order cancellation via eBay's Post-Order Cancellation API
 * (separate base path from the Fulfillment API above, authorized by the
 * same `sell.fulfillment` scope already in `EBAY_SCOPE`). `orderId` is the
 * eBay order id parsed out of `sales.external_order_id`, sent as
 * `legacyOrderId`.
 *
 * UNVERIFIED against eBay's live sandbox at design time — confirm the
 * `legacyOrderId`/`cancelState`/`cancelReason` field names against eBay's
 * current Post-Order API reference before relying on this in production. A
 * wrong field name surfaces as a caught error in the sync-status route
 * (writes `sales.ebay_sync_error`, returns 502), not a crash.
 */
export async function cancelOrder(
  accessToken: string,
  orderId: string,
  body?: CancelOrderBody
): Promise<CancelOrderResult> {
  const res = await fetch(`${EBAY_BASE}/post-order/v2/cancellation`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      legacyOrderId: orderId,
      cancelState: "CANCEL_FULL_ORDER",
      cancelReason: body?.cancelReason ?? "SELLER_CANCEL_BUYER_REQUEST",
    }),
  });

  if (!res.ok) {
    throw new Error(`eBay cancelOrder failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json().catch(() => ({}))) as { cancelId?: string };
  return { cancelId: json.cancelId };
}
