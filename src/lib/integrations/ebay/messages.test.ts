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
});
