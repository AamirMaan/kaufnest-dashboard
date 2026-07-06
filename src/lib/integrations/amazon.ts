import type { NormalizedOrder, PlatformAdapter, TokenSet } from "./types";

const LWA_AUTH_URL = "https://sellercentral.amazon.com/apps/authorize/consent";
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

// Default SP-API region endpoint and marketplace — both overridable via env
// for sellers operating outside the EU (DE) marketplace.
const SPAPI_ENDPOINT = process.env.AMAZON_SPAPI_ENDPOINT ?? "https://sellingpartnerapi-eu.amazon.com";
const DEFAULT_MARKETPLACE_ID = process.env.AMAZON_DEFAULT_MARKETPLACE_ID ?? "A1PA6795UKMFR9"; // Amazon.de

interface AmazonTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface AmazonMoney {
  Amount?: string;
  CurrencyCode?: string;
}

interface AmazonOrder {
  AmazonOrderId: string;
  OrderStatus: string;
  PurchaseDate?: string;
  OrderTotal?: AmazonMoney;
}

interface AmazonOrdersResponse {
  payload?: { Orders?: AmazonOrder[] };
}

interface AmazonOrderItem {
  OrderItemId: string;
  Title?: string;
  QuantityOrdered?: number;
  ItemPrice?: AmazonMoney;
}

interface AmazonOrderItemsResponse {
  payload?: { OrderItems?: AmazonOrderItem[] };
}

function redirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/integrations/amazon/callback`;
}

async function requestToken(body: URLSearchParams): Promise<TokenSet> {
  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Amazon LWA token request failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as AmazonTokenResponse;
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? "",
    expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}

/** Maps SP-API order status onto the Sales feature's status vocabulary. */
function mapStatus(orderStatus: string): string {
  switch (orderStatus) {
    case "Shipped":
      return "shipped";
    case "Canceled":
      return "cancelled";
    case "Unshipped":
    case "PartiallyShipped":
      return "processing";
    default:
      return "pending";
  }
}

export const amazonAdapter: PlatformAdapter = {
  platform: "amazon",

  getAuthUrl(state) {
    const params = new URLSearchParams({
      // The Seller Central consent page expects the SP-API *application id*
      // (amzn1.sellerapps.app…) — NOT the LWA client id
      // (amzn1.application-oa2-client…), which is only used for token calls.
      application_id: process.env.AMAZON_APP_ID ?? "",
      state,
      redirect_uri: redirectUri(),
    });
    // Apps still in "Draft" status in Seller Central require version=beta on
    // the consent URL; Amazon rejects the authorization without it.
    if (process.env.AMAZON_APP_IS_DRAFT === "true") {
      params.set("version", "beta");
    }
    return `${LWA_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code) {
    return requestToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: process.env.AMAZON_LWA_CLIENT_ID ?? "",
        client_secret: process.env.AMAZON_LWA_CLIENT_SECRET ?? "",
        redirect_uri: redirectUri(),
      })
    );
  },

  async refreshAccessToken(refreshToken) {
    return requestToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: process.env.AMAZON_LWA_CLIENT_ID ?? "",
        client_secret: process.env.AMAZON_LWA_CLIENT_SECRET ?? "",
      })
    );
  },

  async fetchOrders(accessToken, sinceISO, marketplaceId) {
    const params = new URLSearchParams({
      MarketplaceIds: marketplaceId ?? DEFAULT_MARKETPLACE_ID,
      CreatedAfter: sinceISO,
    });
    const res = await fetch(`${SPAPI_ENDPOINT}/orders/v0/orders?${params.toString()}`, {
      headers: { "x-amz-access-token": accessToken },
    });

    if (!res.ok) {
      throw new Error(`Amazon SP-API orders request failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as AmazonOrdersResponse;
    const orders: NormalizedOrder[] = [];

    for (const order of json.payload?.Orders ?? []) {
      const itemsRes = await fetch(`${SPAPI_ENDPOINT}/orders/v0/orders/${order.AmazonOrderId}/orderItems`, {
        headers: { "x-amz-access-token": accessToken },
      });
      if (!itemsRes.ok) continue;

      const itemsJson = (await itemsRes.json()) as AmazonOrderItemsResponse;
      const status = mapStatus(order.OrderStatus);
      const date = (order.PurchaseDate ?? new Date().toISOString()).slice(0, 10);

      for (const item of itemsJson.payload?.OrderItems ?? []) {
        const quantity = item.QuantityOrdered ?? 1;
        const totalAmount = Number(item.ItemPrice?.Amount ?? 0);

        orders.push({
          external_order_id: `${order.AmazonOrderId}:${item.OrderItemId}`,
          product_name: item.Title ?? "Amazon order",
          quantity,
          unit_price: Math.round((totalAmount / quantity) * 100) / 100,
          total_amount: totalAmount,
          currency: item.ItemPrice?.CurrencyCode ?? order.OrderTotal?.CurrencyCode ?? "EUR",
          date,
          status,
          description: `Amazon order ${order.AmazonOrderId}`,
        });
      }
    }

    return orders;
  },
};
