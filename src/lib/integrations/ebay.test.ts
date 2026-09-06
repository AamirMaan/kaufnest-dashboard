import { ebayAdapter, createShippingFulfillment, cancelOrder } from "./ebay";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("createShippingFulfillment", () => {
  it("POSTs the shipping_fulfillment endpoint with the exact eBay request shape, and returns the fulfillmentId", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ fulfillmentId: "abc-123" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await createShippingFulfillment("token-1", "order-1", {
      lineItems: [{ lineItemId: "line-1", quantity: 2 }],
      shippedDate: "2026-09-04T00:00:00.000Z",
      shippingCarrierCode: "UPS",
      trackingNumber: "1Z999AA10123456784",
    });

    expect(result).toEqual({ fulfillmentId: "abc-123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/sell/fulfillment/v1/order/order-1/shipping_fulfillment");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer token-1");
    expect(JSON.parse(init.body)).toEqual({
      lineItems: [{ lineItemId: "line-1", quantity: 2 }],
      shippedDate: "2026-09-04T00:00:00.000Z",
      shippingCarrierCode: "UPS",
      trackingNumber: "1Z999AA10123456784",
    });
  });

  it("throws when eBay responds with a non-OK status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"errors":[{"message":"Invalid carrier"}]}'),
    }) as unknown as typeof fetch;

    await expect(
      createShippingFulfillment("token-1", "order-1", {
        lineItems: [{ lineItemId: "line-1", quantity: 1 }],
        shippedDate: "2026-09-04T00:00:00.000Z",
        shippingCarrierCode: "BOGUS",
        trackingNumber: "123",
      })
    ).rejects.toThrow(/400/);
  });

  it("throws when eBay returns 200 with no fulfillmentId", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;

    await expect(
      createShippingFulfillment("token-1", "order-1", {
        lineItems: [{ lineItemId: "line-1", quantity: 1 }],
        shippedDate: "2026-09-04T00:00:00.000Z",
        shippingCarrierCode: "UPS",
        trackingNumber: "123",
      })
    ).rejects.toThrow(/no fulfillmentId/);
  });
});

describe("cancelOrder", () => {
  it("POSTs the post-order cancellation endpoint with the fixed cancelState/cancelReason shape", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ cancelId: "cancel-1" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await cancelOrder("token-1", "order-1");

    expect(result).toEqual({ cancelId: "cancel-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/post-order/v2/cancellation");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      legacyOrderId: "order-1",
      cancelState: "CANCEL_FULL_ORDER",
      cancelReason: "SELLER_CANCEL_BUYER_REQUEST",
    });
  });

  it("allows overriding cancelReason", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await cancelOrder("token-1", "order-1", { cancelReason: "OUT_OF_STOCK" });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).cancelReason).toBe("OUT_OF_STOCK");
  });

  it("throws when eBay responds with a non-OK status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal error"),
    }) as unknown as typeof fetch;

    await expect(cancelOrder("token-1", "order-1")).rejects.toThrow(/500/);
  });
});

function mockJsonResponse(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe("ebayAdapter.fetchOrders — shipping address extraction", () => {
  it("maps fulfillmentStartInstructions' shipTo onto every line item's NormalizedOrder.shipping", async () => {
    mockJsonResponse({
      orders: [
        {
          orderId: "12-34567-89012",
          creationDate: "2026-06-01T10:00:00.000Z",
          orderFulfillmentStatus: "FULFILLED",
          orderPaymentStatus: "PAID",
          lineItems: [
            {
              lineItemId: "001",
              title: "Wireless Mouse",
              quantity: "2",
              total: { value: "19.98", currency: "EUR" },
            },
            {
              lineItemId: "002",
              title: "USB-C Cable",
              quantity: "1",
              total: { value: "5.50", currency: "EUR" },
            },
          ],
          fulfillmentStartInstructions: [
            {
              shippingStep: {
                shipTo: {
                  fullName: "Jane Buyer",
                  contactAddress: {
                    addressLine1: "123 Main St",
                    addressLine2: "Apt 4",
                    city: "Berlin",
                    stateOrProvince: "BE",
                    postalCode: "10115",
                    countryCode: "DE",
                  },
                  primaryPhone: { phoneNumber: "+49 30 1234567" },
                  email: "jane@example.com",
                },
              },
            },
          ],
        },
      ],
    });

    const orders = await ebayAdapter.fetchOrders("token", "2026-01-01T00:00:00.000Z", null);

    expect(orders).toHaveLength(2);
    const expectedShipping = {
      buyerName: "Jane Buyer",
      addressLine1: "123 Main St",
      addressLine2: "Apt 4",
      city: "Berlin",
      state: "BE",
      postalCode: "10115",
      country: "DE",
      phone: "+49 30 1234567",
      email: "jane@example.com",
    };
    expect(orders[0].shipping).toEqual(expectedShipping);
    expect(orders[1].shipping).toEqual(expectedShipping);
  });

  it("sets shipping to null (not undefined) when fulfillmentStartInstructions is missing", async () => {
    mockJsonResponse({
      orders: [
        {
          orderId: "12-34567-89099",
          creationDate: "2026-06-02T10:00:00.000Z",
          orderFulfillmentStatus: "IN_PROGRESS",
          orderPaymentStatus: "PAID",
          lineItems: [
            {
              lineItemId: "001",
              title: "Phone Case",
              quantity: "1",
              total: { value: "9.99", currency: "EUR" },
            },
          ],
        },
      ],
    });

    const orders = await ebayAdapter.fetchOrders("token", "2026-01-01T00:00:00.000Z", null);

    expect(orders).toHaveLength(1);
    expect(orders[0].shipping).toBeNull();
  });

  it("sets shipping to null when fulfillmentStartInstructions is an empty array", async () => {
    mockJsonResponse({
      orders: [
        {
          orderId: "12-34567-89100",
          creationDate: "2026-06-03T10:00:00.000Z",
          orderFulfillmentStatus: "IN_PROGRESS",
          orderPaymentStatus: "PAID",
          lineItems: [
            {
              lineItemId: "001",
              title: "Phone Case",
              quantity: "1",
              total: { value: "9.99", currency: "EUR" },
            },
          ],
          fulfillmentStartInstructions: [],
        },
      ],
    });

    const orders = await ebayAdapter.fetchOrders("token", "2026-01-01T00:00:00.000Z", null);

    expect(orders[0].shipping).toBeNull();
  });
});
