import { getRates, buyLabel } from "./easypost";

const originalFetch = global.fetch;
const originalApiKey = process.env.EASYPOST_API_KEY;

beforeEach(() => {
  process.env.EASYPOST_API_KEY = "EZTKtest123";
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.EASYPOST_API_KEY = originalApiKey;
});

function mockJsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

const fromAddress = {
  name: "KaufNest GmbH",
  street1: "Hauptstr 1",
  street2: null,
  city: "Berlin",
  state: null,
  zip: "10115",
  country: "DE",
  phone: null,
  email: null,
};

const toAddress = {
  name: "Jane Buyer",
  street1: "5th Ave 1",
  street2: null,
  city: "New York",
  state: "NY",
  zip: "10001",
  country: "US",
  phone: null,
  email: null,
};

describe("getRates", () => {
  it("posts to /shipments with from/to/parcel and Basic auth, parsing rates + shipment id", async () => {
    mockJsonResponse({
      id: "shp_123",
      rates: [
        { id: "rate_1", carrier: "USPS", service: "Priority", rate: "7.50", currency: "USD", delivery_days: 2 },
      ],
    });

    const result = await getRates(fromAddress, toAddress, { weightOz: 16 });

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.easypost.com/v2/shipments");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe(
      `Basic ${Buffer.from("EZTKtest123:").toString("base64")}`
    );

    const body = JSON.parse(options.body);
    expect(body.shipment.from_address.street1).toBe("Hauptstr 1");
    expect(body.shipment.to_address.city).toBe("New York");
    expect(body.shipment.parcel.weight).toBe(16);

    expect(result.easypostShipmentId).toBe("shp_123");
    expect(result.rates).toEqual([
      { id: "rate_1", carrier: "USPS", service: "Priority", rate: "7.50", currency: "USD", deliveryDays: 2 },
    ]);
  });

  it("throws with EasyPost's own error message on a non-2xx response", async () => {
    mockJsonResponse({ error: { message: "Invalid to_address: zip is required" } }, false, 422);

    await expect(getRates(fromAddress, toAddress, { weightOz: 16 })).rejects.toThrow(
      "Invalid to_address: zip is required"
    );
  });

  it("throws a generic message when the error response has no error.message", async () => {
    mockJsonResponse({}, false, 500);

    await expect(getRates(fromAddress, toAddress, { weightOz: 16 })).rejects.toThrow(
      "EasyPost request failed with status 500"
    );
  });
});

describe("buyLabel", () => {
  it("posts to /shipments/{id}/buy with the chosen rate id, parsing the label response", async () => {
    mockJsonResponse({
      tracking_code: "9400111899223197428490",
      postage_label: { label_url: "https://easypost-files.example/label.pdf", label_file_type: "PDF" },
    });

    const label = await buyLabel("shp_123", "rate_1");

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.easypost.com/v2/shipments/shp_123/buy");
    expect(JSON.parse(options.body)).toEqual({ rate: { id: "rate_1" } });

    expect(label).toEqual({
      trackingNumber: "9400111899223197428490",
      labelUrl: "https://easypost-files.example/label.pdf",
      labelFormat: "PDF",
    });
  });

  it("defaults labelFormat to PDF when EasyPost omits label_file_type", async () => {
    mockJsonResponse({
      tracking_code: "TRACK123",
      postage_label: { label_url: "https://easypost-files.example/label.pdf" },
    });

    const label = await buyLabel("shp_123", "rate_1");
    expect(label.labelFormat).toBe("PDF");
  });

  it("throws with EasyPost's own error message on a non-2xx response", async () => {
    mockJsonResponse({ error: { message: "Rate has expired" } }, false, 422);

    await expect(buyLabel("shp_123", "rate_1")).rejects.toThrow("Rate has expired");
  });
});
