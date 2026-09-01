import {
  fetchListingDetail,
  reviseListing,
  endListing,
  buildAspectsForRevise,
  conditionIdToListingCondition,
} from "./listings";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function mockXmlResponse(xml: string) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(xml),
  }) as unknown as typeof fetch;
}

describe("conditionIdToListingCondition", () => {
  it("maps New and New other to new", () => {
    expect(conditionIdToListingCondition("1000")).toBe("new");
    expect(conditionIdToListingCondition("1500")).toBe("new");
  });

  it("maps the two refurbished IDs to refurbished", () => {
    expect(conditionIdToListingCondition("2000")).toBe("refurbished");
    expect(conditionIdToListingCondition("2500")).toBe("refurbished");
  });

  it("falls back to used for anything else, including null", () => {
    expect(conditionIdToListingCondition("3000")).toBe("used");
    expect(conditionIdToListingCondition("7000")).toBe("used");
    expect(conditionIdToListingCondition(null)).toBe("used");
  });
});

describe("fetchListingDetail", () => {
  const GET_ITEM_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>
    <GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <Ack>Success</Ack>
      <Item>
        <ItemID>111222333</ItemID>
        <Title>Wireless Mouse</Title>
        <Description><![CDATA[<p>A great mouse &amp; more</p>]]></Description>
        <PrimaryCategory>
          <CategoryID>9355</CategoryID>
          <CategoryName>Cell Phones</CategoryName>
        </PrimaryCategory>
        <ConditionID>1000</ConditionID>
        <Quantity>5</Quantity>
        <SellingStatus>
          <CurrentPrice currencyID="EUR">19.99</CurrentPrice>
        </SellingStatus>
        <PictureDetails>
          <PictureURL>https://example.com/1.jpg</PictureURL>
          <PictureURL>https://example.com/2.jpg</PictureURL>
        </PictureDetails>
        <ItemSpecifics>
          <NameValueList><Name>Brand</Name><Value>Acme</Value></NameValueList>
          <NameValueList><Name>Type</Name><Value>Wireless</Value></NameValueList>
        </ItemSpecifics>
      </Item>
    </GetItemResponse>`;

  it("parses a full item into EbayListingDetail", async () => {
    mockXmlResponse(GET_ITEM_RESPONSE);

    const detail = await fetchListingDetail("token", "111222333");

    expect(detail).toEqual({
      ebayListingId: "111222333",
      title: "Wireless Mouse",
      description: "<p>A great mouse & more</p>",
      price: 19.99,
      currency: "EUR",
      quantity: 5,
      condition: "new",
      imageUrls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      categoryId: "9355",
      categoryName: "Cell Phones",
      aspects: { Brand: "Acme", Type: "Wireless" },
      multiValueAspectNames: [],
    });
  });

  it("collapses a multi-value NameValueList to its first value only (v1 doesn't support MULTI-cardinality aspects)", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <Item>
          <ItemID>2</ItemID>
          <Title>Multi-value aspect</Title>
          <Description></Description>
          <PrimaryCategory><CategoryID>1</CategoryID><CategoryName>Misc</CategoryName></PrimaryCategory>
          <SellingStatus><CurrentPrice currencyID="EUR">5.00</CurrentPrice></SellingStatus>
          <ItemSpecifics>
            <NameValueList><Name>Color</Name><Value>Red</Value><Value>Blue</Value></NameValueList>
          </ItemSpecifics>
        </Item>
      </GetItemResponse>`);

    const detail = await fetchListingDetail("token", "2");
    expect(detail.aspects).toEqual({ Color: "Red" });
    expect(detail.multiValueAspectNames).toEqual(["Color"]);
  });

  it("defaults quantity to 1 and condition to used when absent", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <Item>
          <ItemID>1</ItemID>
          <Title>No condition or quantity</Title>
          <Description></Description>
          <PrimaryCategory><CategoryID>1</CategoryID><CategoryName>Misc</CategoryName></PrimaryCategory>
          <SellingStatus><CurrentPrice currencyID="EUR">5.00</CurrentPrice></SellingStatus>
        </Item>
      </GetItemResponse>`);

    const detail = await fetchListingDetail("token", "1");
    expect(detail.quantity).toBe(1);
    expect(detail.condition).toBe("used");
    expect(detail.imageUrls).toEqual([]);
    expect(detail.aspects).toEqual({});
  });
});

describe("buildAspectsForRevise", () => {
  it("returns undefined when the maps are identical", () => {
    expect(buildAspectsForRevise({ Brand: "Acme" }, { Brand: "Acme" })).toBeUndefined();
  });

  it("returns undefined when both are empty", () => {
    expect(buildAspectsForRevise({}, {})).toBeUndefined();
  });

  it("returns the submitted map when a value changed", () => {
    expect(buildAspectsForRevise({ Brand: "Acme" }, { Brand: "Other" })).toEqual({
      Brand: "Other",
    });
  });

  it("returns the submitted map when a key was added", () => {
    expect(buildAspectsForRevise({ Brand: "Acme" }, { Brand: "Acme", Type: "New" })).toEqual({
      Brand: "Acme",
      Type: "New",
    });
  });

  it("returns the submitted map when a key was removed", () => {
    expect(
      buildAspectsForRevise({ Brand: "Acme", Type: "New" }, { Brand: "Acme" })
    ).toEqual({ Brand: "Acme" });
  });
});

describe("reviseListing", () => {
  it("sends the complete image list and no ItemSpecifics when aspects is omitted", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <ReviseItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></ReviseItemResponse>`);

    await reviseListing("token", "111", {
      title: "New title",
      description: "New description",
      price: 25,
      quantity: 3,
      condition: "used",
      imageUrls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
    });

    const sentBody = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
    expect(sentBody).toMatch(/<PictureURL>https:\/\/example\.com\/a\.jpg<\/PictureURL>/);
    expect(sentBody).toMatch(/<PictureURL>https:\/\/example\.com\/b\.jpg<\/PictureURL>/);
    expect(sentBody).not.toMatch(/<ItemSpecifics>/);
    expect(sentBody).toMatch(/<ConditionID>3000<\/ConditionID>/);
    expect(sentBody).toMatch(/<StartPrice>25\.00<\/StartPrice>/);
  });

  it("includes ItemSpecifics when aspects is provided", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <ReviseItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></ReviseItemResponse>`);

    await reviseListing("token", "111", {
      title: "T",
      description: "D",
      price: 10,
      quantity: 1,
      condition: "new",
      imageUrls: [],
      aspects: { Brand: "Acme" },
    });

    const sentBody = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
    expect(sentBody).toMatch(
      /<ItemSpecifics><NameValueList><Name>Brand<\/Name><Value>Acme<\/Value><\/NameValueList><\/ItemSpecifics>/
    );
  });
});

describe("endListing", () => {
  it("sends an EndItem request with EndingReason NotAvailable", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <EndItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></EndItemResponse>`);

    await endListing("token", "111");

    const sentBody = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
    expect(sentBody).toMatch(/<ItemID>111<\/ItemID>/);
    expect(sentBody).toMatch(/<EndingReason>NotAvailable<\/EndingReason>/);
  });
});
