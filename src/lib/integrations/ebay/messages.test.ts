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

describe("fetchMemberMessages", () => {
  it("parses an inbound message from a MemberMessageExchange block", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        <MemberMessageExchange>
          <ItemID>123456789</ItemID>
          <MemberMessage>
            <MessageID>msg-1</MessageID>
            <Sender>buyer1</Sender>
            <RecipientID>seller1</RecipientID>
            <Incoming>true</Incoming>
            <Subject>Question about item</Subject>
            <Text>Is this still available?</Text>
            <QuestionType>General</QuestionType>
            <Read>false</Read>
            <CreationDate>2026-07-20T10:00:00.000Z</CreationDate>
          </MemberMessage>
        </MemberMessageExchange>
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
      },
    ]);
  });

  it("derives buyerUsername from RecipientID for an outbound (Incoming=false) message", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        <MemberMessageExchange>
          <ItemID>123456789</ItemID>
          <MemberMessage>
            <MessageID>msg-2</MessageID>
            <Sender>seller1</Sender>
            <RecipientID>buyer1</RecipientID>
            <Incoming>false</Incoming>
            <Text>Yes, still available!</Text>
            <Read>true</Read>
            <CreationDate>2026-07-20T11:00:00.000Z</CreationDate>
          </MemberMessage>
        </MemberMessageExchange>
      </GetMemberMessagesResponse>`);

    const [message] = await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");

    expect(message.direction).toBe("outbound");
    expect(message.buyerUsername).toBe("buyer1");
  });

  it("decodes XML entities in the message body and subject", async () => {
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        <MemberMessageExchange>
          <ItemID>1</ItemID>
          <MemberMessage>
            <MessageID>msg-3</MessageID>
            <Sender>buyer1</Sender>
            <Incoming>true</Incoming>
            <Text>Price &amp; shipping &lt;fast&gt;?</Text>
            <Read>false</Read>
            <CreationDate>2026-07-20T10:00:00.000Z</CreationDate>
          </MemberMessage>
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

  it("logs a warning and still treats the message as inbound when <Incoming> is absent (schema assumption broken, not silently misparsed)", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        <MemberMessageExchange>
          <ItemID>1</ItemID>
          <MemberMessage>
            <MessageID>msg-4</MessageID>
            <Sender>buyer1</Sender>
            <Text>No Incoming tag on this one</Text>
            <Read>false</Read>
            <CreationDate>2026-07-20T10:00:00.000Z</CreationDate>
          </MemberMessage>
        </MemberMessageExchange>
      </GetMemberMessagesResponse>`);

    const [message] = await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");

    expect(message.direction).toBe("inbound");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("msg-4"));
    warnSpy.mockRestore();
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
    // Simulates the real 2026-08-26 production finding: 46 exchange blocks,
    // 0 parsed. Here the account's response nests under <Message>, not the
    // <MemberMessage> parseExchangeBlock assumes — a stand-in for whatever
    // the real mismatch turns out to be, to prove the diagnostic surfaces
    // structure without needing to guess the real shape in this test.
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
    expect(meta).toMatchObject({ memberMessageTagCount: 0 });
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
        <MemberMessageExchange>
          <ItemID>1</ItemID>
          <MemberMessage>
            <MessageID>msg-5</MessageID>
            <Sender>buyer1</Sender>
            <Incoming>true</Incoming>
            <Text>Fine as-is</Text>
            <Read>false</Read>
            <CreationDate>2026-07-20T10:00:00.000Z</CreationDate>
          </MemberMessage>
        </MemberMessageExchange>
      </GetMemberMessagesResponse>`);

    await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");

    expect(
      warnSpy.mock.calls.some(([msg]) => typeof msg === "string" && msg.includes("schema mismatch"))
    ).toBe(false);
    warnSpy.mockRestore();
  });
});
