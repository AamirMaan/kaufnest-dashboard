import type { NormalizedOrder, PlatformAdapter, TokenSet } from "./types";

const SANDBOX = process.env.EBAY_SANDBOX === "true";
const EBAY_BASE = SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const EBAY_AUTH_URL = SANDBOX
  ? "https://auth.sandbox.ebay.com/oauth2/authorize"
  : "https://auth.ebay.com/oauth2/authorize";
const EBAY_TOKEN_URL = `${EBAY_BASE}/identity/v1/oauth2/token`;
const EBAY_ORDERS_URL = `${EBAY_BASE}/sell/fulfillment/v1/order`;
const EBAY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment" +
  " https://api.ebay.com/oauth/api_scope/sell.inventory.readonly";

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

interface EbayOrder {
  orderId: string;
  creationDate?: string;
  orderFulfillmentStatus?: string;
  orderPaymentStatus?: string;
  lineItems?: EbayLineItem[];
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
        });
      }
    }

    return orders;
  },
};
