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

// Real shape confirmed live 2026-08-26 against tenant_kaufnest's connected
// account — see the schema-mismatch gotcha in dashboard/messages/SKILL.md.
// <Question> is the message wrapper (not <MemberMessage>, which never
// appears in a real response), ItemID nests under <Item>, and there is no
// <Incoming> tag at all — every message here is inbound by construction.
const REAL_SHAPE_EXCHANGE = `
  <MemberMessageExchange>
    <Item>
      <ItemID>123456789</ItemID>
      <Title>Sample listing</Title>
    </Item>
    <Question>
      <MessageID>msg-1</MessageID>
      <SenderID>buyer1</SenderID>
      <RecipientID>seller1</RecipientID>
      <Subject>Question about item</Subject>
      <Body>Is this still available?</Body>
      <QuestionType>General</QuestionType>
      <MessageStatus>Unanswered</MessageStatus>
      <CreationDate>2026-07-20T10:00:00.000Z</CreationDate>
    </Question>
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
      },
    ]);
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
            <MessageStatus>Answered</MessageStatus>
            <CreationDate>2026-07-20T10:00:00.000Z</CreationDate>
          </Question>
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
            <MessageStatus>Unanswered</MessageStatus>
            <CreationDate>2026-07-20T10:00:00.000Z</CreationDate>
          </Question>
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

  it("logs a redacted structural skeleton of the exchange XML — tag names/nesting kept, all text content stripped", async () => {
    // Needed to see WHERE a field actually lives in a real response (e.g.
    // CreationDate) without a captured fixture and without logging any
    // buyer content. This is the mechanism, not a claim about the real
    // shape — that's still unconfirmed, which is exactly why it exists.
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        ${REAL_SHAPE_EXCHANGE}
      </GetMemberMessagesResponse>`);

    await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");

    const call = infoSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("exchange structure")
    )!;
    const skeleton = call[1] as string;
    expect(skeleton).toContain("<MemberMessageExchange>");
    expect(skeleton).toContain("<Question>");
    expect(skeleton).toContain("<CreationDate>…</CreationDate>");
    // Structure preserved, content redacted — no buyer data leaks into logs.
    expect(skeleton).not.toContain("buyer1");
    expect(skeleton).not.toContain("Is this still available?");
    infoSpy.mockRestore();
  });

  it("redacts every leaf value uniformly — including short, non-sensitive-looking ones like an id — rather than selectively picking which fields to hide", async () => {
    // Redaction is deliberately all-or-nothing: no per-field allowlist to
    // maintain or accidentally miss. The point is tag structure, not values.
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    mockXmlResponse(`<?xml version="1.0" encoding="utf-8"?>
      <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
        <Ack>Success</Ack>
        <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
        <MemberMessageExchange>
          <Item>
            <ItemID>123456789</ItemID>
          </Item>
        </MemberMessageExchange>
      </GetMemberMessagesResponse>`);

    await fetchMemberMessages("token", "2026-01-01T00:00:00.000Z");

    const call = infoSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("exchange structure")
    )!;
    const skeleton = call[1] as string;
    expect(skeleton).toContain("<Item>");
    expect(skeleton).toContain("<ItemID>…</ItemID>");
    expect(skeleton).not.toContain("123456789");
    // Pure indentation whitespace between <MemberMessageExchange> and <Item>
    // must be left alone, not turned into its own "…" — only genuine text
    // nodes (like ItemID's value above) get redacted.
    expect(skeleton).not.toMatch(/<MemberMessageExchange>\s*…/);
    infoSpy.mockRestore();
  });
});
