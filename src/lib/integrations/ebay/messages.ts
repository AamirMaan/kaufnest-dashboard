// Reads and replies to eBay buyer messages via the Trading API
// (GetMemberMessages / AddMemberMessageRTQ) — there is no REST endpoint for
// general buyer<->seller messaging, only Post-Order API endpoints scoped to
// returns/INR disputes, which don't cover ordinary "question about an item"
// messages. Same auth/error-handling as listings.ts, via ./tradingApi.
//
// Gotcha: eBay's XML schema for GetMemberMessages nests messages inside a
// <MemberMessageExchange> block per item, with <ItemID> as a sibling of
// (not inside) each <MemberMessage> — parsing below scopes ItemID lookup to
// the enclosing exchange block rather than the individual message. This is
// unverified against a live response (no sandbox test data available at
// implementation time) — if fields come back empty/misparsed, verify the
// actual response shape against a real synced account first.

import { tradingApiCall, tagText, decodeXml, escapeXml } from "./tradingApi";

const ENTRIES_PER_PAGE = 200;
const MAX_PAGES = 10; // safety cap: 2000 messages

export interface EbayMemberMessage {
  externalMessageId: string;
  itemId: string;
  buyerUsername: string;
  direction: "inbound" | "outbound";
  subject: string | null;
  body: string;
  questionType: string | null;
  isRead: boolean;
  ebayCreatedAt: string;
}

function buildGetMemberMessagesRequest(sinceISO: string, pageNumber: number): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<GetMemberMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    "<MailMessageType>All</MailMessageType>" +
    "<MessageStatus>All</MessageStatus>" +
    `<StartCreationTime>${sinceISO}</StartCreationTime>` +
    "<DetailLevel>ReturnMessages</DetailLevel>" +
    "<Pagination>" +
    `<EntriesPerPage>${ENTRIES_PER_PAGE}</EntriesPerPage>` +
    `<PageNumber>${pageNumber}</PageNumber>` +
    "</Pagination>" +
    "</GetMemberMessagesRequest>"
  );
}

function parseExchangeBlock(exchangeXml: string): EbayMemberMessage[] {
  const itemId = tagText(exchangeXml, "ItemID") ?? "";
  const messages: EbayMemberMessage[] = [];

  const messageBlocks = exchangeXml.match(/<MemberMessage>[\s\S]*?<\/MemberMessage>/g) ?? [];
  for (const block of messageBlocks) {
    const messageId = tagText(block, "MessageID");
    const text = tagText(block, "Text");
    if (!messageId || !text) continue;

    // Incoming=true means the seller received it (buyer is the Sender);
    // Incoming=false means the seller sent it (buyer is the RecipientID).
    const incoming = tagText(block, "Incoming") !== "false";
    const buyerUsername = incoming ? tagText(block, "Sender") : tagText(block, "RecipientID");

    messages.push({
      externalMessageId: messageId,
      itemId,
      buyerUsername: decodeXml(buyerUsername ?? ""),
      direction: incoming ? "inbound" : "outbound",
      subject: (() => {
        const subject = tagText(block, "Subject");
        return subject ? decodeXml(subject) : null;
      })(),
      body: decodeXml(text),
      questionType: tagText(block, "QuestionType"),
      isRead: tagText(block, "Read") === "true",
      ebayCreatedAt: tagText(block, "CreationDate") ?? new Date().toISOString(),
    });
  }

  return messages;
}

/** Fetches inbound + outbound member messages created since `sinceISO` (ISO timestamp). */
export async function fetchMemberMessages(
  accessToken: string,
  sinceISO: string
): Promise<EbayMemberMessage[]> {
  const messages: EbayMemberMessage[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const xml = await tradingApiCall(
      "GetMemberMessages",
      buildGetMemberMessagesRequest(sinceISO, page),
      accessToken
    );

    const exchangeBlocks = xml.match(/<MemberMessageExchange>[\s\S]*?<\/MemberMessageExchange>/g) ?? [];
    for (const block of exchangeBlocks) {
      messages.push(...parseExchangeBlock(block));
    }

    const totalPages = Number(tagText(xml, "PaginationResult")?.match(/(\d+)/)?.[1] ?? "1");
    if (page >= totalPages) break;
  }

  return messages;
}

function buildAddMemberMessageRTQRequest(
  itemId: string,
  parentMessageId: string,
  recipientUsername: string,
  body: string
): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<AddMemberMessageRTQRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    `<ItemID>${escapeXml(itemId)}</ItemID>` +
    "<MemberMessage>" +
    `<ParentMessageID>${escapeXml(parentMessageId)}</ParentMessageID>` +
    `<RecipientID>${escapeXml(recipientUsername)}</RecipientID>` +
    `<Body>${escapeXml(body)}</Body>` +
    "<DisplayToPublic>false</DisplayToPublic>" +
    "</MemberMessage>" +
    "</AddMemberMessageRTQRequest>"
  );
}

/** Replies to an existing buyer message. Throws on failure — no payload on success. */
export async function replyToMessage(
  accessToken: string,
  itemId: string,
  parentMessageId: string,
  recipientUsername: string,
  body: string
): Promise<void> {
  await tradingApiCall(
    "AddMemberMessageRTQ",
    buildAddMemberMessageRTQRequest(itemId, parentMessageId, recipientUsername, body),
    accessToken
  );
}
