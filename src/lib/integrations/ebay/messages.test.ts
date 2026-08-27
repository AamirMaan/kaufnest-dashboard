import { fetchMemberMessages } from "./messages";

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

const ONE_PAGE = `<?xml version="1.0" encoding="utf-8"?>
  <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
    <Ack>Success</Ack>
    <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
  </GetMemberMessagesResponse>`;

// Real shape confirmed live 2026-08-26/27 against tenant_kaufnest's connected
// account — see the schema-mismatch gotcha in dashboard/messages/SKILL.md.
// <Question> is the message wrapper (not <MemberMessage>, which never
// appears in a real response), ItemID nests under <Item>, and there is no
// <Incoming> tag at all — every message here is inbound by construction.
// <CreationDate> and <MessageStatus> are siblings of <Question>, at the
// <MemberMessageExchange> level — NOT nested inside <Question>, confirmed
// via the redactedStructure diagnostic 2026-08-27.
const REAL_SHAPE_EXCHANGE = `
  <MemberMessageExchange>
    <Item>
      <ItemID>123456789</ItemID>
      <Title>Sample listing</Title>
      <SellingStatus><CurrentPrice currencyID="EUR">12.99</CurrentPrice></SellingStatus>
      <ViewItemURL>https://www.ebay.de/itm/123456789</ViewItemURL>
    </Item>
    <Question>
      <MessageID>msg-1</MessageID>
      <SenderID>buyer1</SenderID>
      <RecipientID>seller1</RecipientID>
      <Subject>Question about item</Subject>
      <Body>Is this still available?</Body>
      <QuestionType>General</QuestionType>
    </Question>
    <MessageStatus>Unanswered</MessageStatus>
    <CreationDate>2026-07-20T10:00:00.000Z</CreationDate>
  </MemberMessageExchange>`;

describe("fetchMemberMessages", () => {
  it("parses a question from a MemberMessageExchange block (real <Question> wrapper, not <MemberMessage>)", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        ${REAL_SHAPE_EXCHANGE}
      </GetMemberMessagesResponse>`);

    const messages = await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");

    expect(messages).toEqual([
      {
        externalMessageId: "msg-1",
        itemId: "123456789",
        buyerUsername: "buyer1",
        direction: "inbound",
        subject: "Question about item",
        body: "Is this still available?",
        questionType: "General",
        isRead: false,
        ebayCreatedAt: "2026-07-20T10:00:00.000Z",
        itemTitle: "Sample listing",
        itemPrice: 12.99,
        itemCurrency: "EUR",
        itemUrl: "https://www.ebay.de/itm/123456789",
      },
    ]);
  });

  it("falls back to null for item title/price/currency/url when the exchange doesn't carry them", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        <MemberMessageExchange>
          <Item><ItemID>1</ItemID></Item>
          <Question>
            <MessageID>msg-no-item-details</MessageID>
            <SenderID>buyer1</SenderID>
            <Body>No item details on this one</Body>
          </Question>
          <MessageStatus>Unanswered</MessageStatus>
          <CreationDate>2026-07-20T10:00:00.000Z</CreationDate>
        </MemberMessageExchange>
      </GetMemberMessagesResponse>`);

    const [message] = await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");
    expect(message.itemTitle).toBeNull();
    expect(message.itemPrice).toBeNull();
    expect(message.itemCurrency).toBeNull();
    expect(message.itemUrl).toBeNull();
  });

  it("is always inbound — GetMemberMessages only ever returns buyers' messages, never the seller's own replies", async () => {
    // RecipientID being present (the seller's own username) must not flip
    // direction the way the old removed <Incoming>-based logic did.
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        ${REAL_SHAPE_EXCHANGE}
      </GetMemberMessagesResponse>`);

    const [message] = await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");
    expect(message.direction).toBe("inbound");
    expect(message.buyerUsername).toBe("buyer1");
  });

  it("treats MessageStatus=Answered as read, Unanswered as unread", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        <MemberMessageExchange>
          <Item><ItemID>1</ItemID></Item>
          <Question>
            <MessageID>msg-answered</MessageID>
            <SenderID>buyer1</SenderID>
            <Body>Already answered</Body>
          </Question>
          <MessageStatus>Answered</MessageStatus>
          <CreationDate>2026-07-20T10:00:00.000Z</CreationDate>
        </MemberMessageExchange>
      </GetMemberMessagesResponse>`);

    const [message] = await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");
    expect(message.isRead).toBe(true);
  });

  it("decodes XML entities in the message body and subject", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        <MemberMessageExchange>
          <Item><ItemID>1</ItemID></Item>
          <Question>
            <MessageID>msg-3</MessageID>
            <SenderID>buyer1</SenderID>
            <Body>Price &amp; shipping &lt;fast&gt;?</Body>
          </Question>
          <MessageStatus>Unanswered</MessageStatus>
          <CreationDate>2026-07-20T10:00:00.000Z</CreationDate>
        </MemberMessageExchange>
      </GetMemberMessagesResponse>`);

    const [message] = await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");
    expect(message.body).toBe("Price & shipping <fast>?");
  });

  it("throws with a reconnect message on an insufficient-scope error", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Failure</Ack>
        <Errors>
          <ErrorCode>21916984</ErrorCode>
          <LongMessage>Insufficient permissions</LongMessage>
        </Errors>
      </GetMemberMessagesResponse>`);

    await expect(fetchMemberMessages("token", "2026-01-01T00:00:00.000Z")).rejects.toThrow(
      /re-authorization/
    );
  });

  it("never sends a MessageStatus element (eBay rejects it: only Answered/Unanswered/CustomCode are valid, not the 'All' this used to send)", async () => {
    mockXmlResponse(ONE_PAGE);

    await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");

    const sentBody = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
    expect(sentBody).not.toMatch(/<MessageStatus>/);
    // MailMessageType=All IS a valid enum value for that (different) field — must survive.
    expect(sentBody).toMatch(/<MailMessageType>All<\/MailMessageType>/);
  });

  it("reads TotalNumberOfPages specifically, not the first digit sequence in PaginationResult", async () => {
    // Regression guard: PaginationResult also carries TotalNumberOfEntries,
    // which eBay may emit before TotalNumberOfPages. A naive /(\d+)/ match
    // against the whole tag text would read 500 here and try up to 10 pages
    // (MAX_PAGES) instead of stopping after page 1.
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult>
          <TotalNumberOfEntries>500</TotalNumberOfEntries>
          <TotalNumberOfPages>1</TotalNumberOfPages>
        </PaginationResult>
      </GetMemberMessagesResponse>`);

    await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("logs how many exchange blocks eBay returned per page, so an empty result can be told apart from a parsing failure without another deploy", async () => {
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    mockXmlResponse(ONE_PAGE); // zero <MemberMessageExchange> blocks

    await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("page 1"),
      expect.objectContaining({ exchangeBlocks: 0, messagesParsed: 0 })
    );
    infoSpy.mockRestore();
  });

  it("warns with the real tag names (never message content) when exchange blocks exist but none parse", async () => {
    // Synthetic wrong-shape example (not the real one, which is now fixed) —
    // this pins the diagnostic's own behavior as a permanent defense against
    // a FUTURE schema change, independent of what shape is currently correct.
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        <MemberMessageExchange>
          <ItemID>111</ItemID>
          <Message>
            <ExternalMessageID>abc-123</ExternalMessageID>
            <Body>A real buyer's private question that must never reach a log line</Body>
          </Message>
        </MemberMessageExchange>
      </GetMemberMessagesResponse>`);

    const messages = await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");

    expect(messages).toEqual([]);
    const [, meta] = warnSpy.mock.calls.find(([msg]) =>
      typeof msg === "string" && msg.includes("schema mismatch")
    )!;
    expect(meta).toMatchObject({ questionTagCount: 0 });
    expect(meta.tagsInFirstBlock).toEqual(
      expect.arrayContaining(["ItemID", "Message", "ExternalMessageID", "Body"])
    );

    // Privacy: the buyer's message text must never appear in any logged call.
    for (const call of warnSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("A real buyer's private question");
    }
    warnSpy.mockRestore();
  });

  it("does not warn when every exchange block parses successfully", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        ${REAL_SHAPE_EXCHANGE}
      </GetMemberMessagesResponse>`);

    await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");

    expect(
      warnSpy.mock.calls.some(([msg]) => typeof msg === "string" && msg.includes("schema mismatch"))
    ).toBe(false);
    warnSpy.mockRestore();
  });

  it("reads CreationDate/MessageStatus from the exchange level, not from inside Question", async () => {
    // Regression guard for the 2026-08-27 fix: both fields are siblings of
    // <Question> at the <MemberMessageExchange> level (confirmed live via
    // the now-removed redactedStructure diagnostic), not nested inside
    // <Question> as originally assumed — which previously made ebayCreatedAt
    // fall back to "now" and isRead always false.
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        ${REAL_SHAPE_EXCHANGE}
      </GetMemberMessagesResponse>`);

    const [message] = await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");
    expect(message.ebayCreatedAt).toBe("2026-07-20T10:00:00.000Z");
    expect(message.isRead).toBe(false);
  });
});
