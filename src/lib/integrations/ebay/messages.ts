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
    // No <MessageStatus> element: its enum (MessageStatusTypeCodeType) is only
    // Answered/Unanswered/CustomCode — "All" is not a valid value and makes
    // eBay return Ack=Failure on this call. Omitting it returns both answered
    // and unanswered messages, which is the behavior "All" was meant to express
    // (verified against eBay's Trading API docs, 2026-08-26).
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
    const incomingRaw = tagText(block, "Incoming");
    if (incomingRaw === null) {
      // Falls through to the inbound default below (preserves prior
      // behavior), but this means the <Incoming> nesting assumption in this
      // file's header comment is wrong for at least one real message — worth
      // knowing rather than silently misclassifying every future reply too.
      console.warn(
        `[ebay/messages] <Incoming> missing on message ${messageId} — schema assumption may be wrong, defaulting to inbound`
      );
    }
    const incoming = incomingRaw !== "false";
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
    const pageMessages = exchangeBlocks.flatMap(parseExchangeBlock);
    messages.push(...pageMessages);

    // Diagnostic, not an error: distinguishes "eBay genuinely returned
    // nothing" from "eBay returned exchange blocks but parseExchangeBlock
    // dropped them" without needing another deploy to find out. Relevant
    // because GetMemberMessages is scoped to the seller's currently ACTIVE
    // listings only (unlike the web Messages Hub) — 0 here on every sync is
    // expected, not a bug, if the account's real conversation history is
    // about items that have since sold or ended. See messages/SKILL.md.
    console.info(`[ebay/messages] GetMemberMessages page ${page}:`, {
      exchangeBlocks: exchangeBlocks.length,
      messagesParsed: pageMessages.length,
    });

    // Scope to PaginationResult, then read TotalNumberOfPages specifically —
    // that tag also carries TotalNumberOfEntries, and eBay does not guarantee
    // TotalNumberOfPages appears first, so a bare digit match against the
    // whole tag text can silently read the entries count instead (same fix
    // as listings.ts:86).
    const pagination = tagText(xml, "PaginationResult") ?? "";
    const totalPages = Number(tagText(pagination, "TotalNumberOfPages") ?? "1");
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
