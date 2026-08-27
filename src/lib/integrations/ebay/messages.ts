// Reads and replies to eBay buyer messages via the Trading API
// (GetMemberMessages / AddMemberMessageRTQ) — there is no REST endpoint for
// general buyer<->seller messaging, only Post-Order API endpoints scoped to
// returns/INR disputes, which don't cover ordinary "question about an item"
// messages. Same auth/error-handling as listings.ts, via ./tradingApi.
//
// CONFIRMED against a real synced account (2026-08-26, tenant_kaufnest —
// see the schema-mismatch gotcha in dashboard/messages/SKILL.md for how):
// each <MemberMessageExchange> wraps its message in <Question>, an
// "Ask Seller a Question" (ASQ) container — NOT <MemberMessage>, which the
// original implementation assumed and which does not appear anywhere in a
// real response. <ItemID> is nested one level deeper under <Item>, but
// `tagText` searches the whole exchange block regardless of depth, so that
// part needed no change. Fields inside <Question>: SenderID (not Sender),
// Body (not Text), MessageStatus (Answered/Unanswered — not a Read boolean).
// There is no <Incoming> tag at all: per eBay's own docs, GetMemberMessages
// only ever returns messages BUYERS have posted, never the seller's own
// replies (AddMemberMessageRTQ has no response payload to sync back either
// — see replyToMessage below and reply/route.ts, which writes the outbound
// row locally instead). So every message this function returns is inbound,
// unconditionally — there is no direction to infer.

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
  itemTitle: string | null;
  itemPrice: number | null;
  itemCurrency: string | null;
  itemUrl: string | null;
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

/**
 * Replaces every leaf text node with "…", keeping all tag names and nesting
 * intact — reveals the real shape of an eBay response (which field lives
 * where) without exposing any buyer content in a log. Deliberately
 * all-or-nothing: no per-field allowlist of "safe" tags to maintain or
 * accidentally get wrong. Whitespace-only spans between tags (pretty-printed
 * indentation) are left alone — only genuine text content is redacted.
 */
function redactedStructure(xml: string): string {
  return xml.replace(/>([^<]*[^\s<][^<]*)</g, ">…<");
}

// <CurrentPrice currencyID="EUR">12.99</CurrentPrice> — same eBay Trading API
// MoneyType shape listings.ts already parses for GetMyeBaySelling; reused
// verbatim since GetMemberMessages' <Item> block uses the same convention.
const CURRENT_PRICE = /<CurrentPrice currencyID="([A-Z]{3})">([\d.]+)<\/CurrentPrice>/;

function parseExchangeBlock(exchangeXml: string): EbayMemberMessage[] {
  const itemId = tagText(exchangeXml, "ItemID") ?? "";
  // Confirmed live 2026-08-27: <Item> also carries Title, SellingStatus/
  // CurrentPrice, and ViewItemURL — previously discarded, so the Messages
  // UI could show nothing better than the bare numeric item id.
  const itemTitle = tagText(exchangeXml, "Title");
  const priceMatch = CURRENT_PRICE.exec(exchangeXml);
  const itemUrl = tagText(exchangeXml, "ViewItemURL");
  const messages: EbayMemberMessage[] = [];

  const messageBlocks = exchangeXml.match(/<Question>[\s\S]*?<\/Question>/g) ?? [];
  for (const block of messageBlocks) {
    const messageId = tagText(block, "MessageID");
    const text = tagText(block, "Body");
    if (!messageId || !text) continue;

    messages.push({
      externalMessageId: messageId,
      itemId,
      buyerUsername: decodeXml(tagText(block, "SenderID") ?? ""),
      direction: "inbound",
      subject: (() => {
        const subject = tagText(block, "Subject");
        return subject ? decodeXml(subject) : null;
      })(),
      body: decodeXml(text),
      questionType: tagText(block, "QuestionType"),
      // No true read/unread signal exists in this response. MessageStatus
      // (Answered/Unanswered) is the closest real proxy — a question the
      // seller has already answered is treated as read.
      isRead: tagText(block, "MessageStatus") === "Answered",
      ebayCreatedAt: tagText(block, "CreationDate") ?? new Date().toISOString(),
      itemTitle: itemTitle ? decodeXml(itemTitle) : null,
      itemPrice: priceMatch ? Number(priceMatch[2]) : null,
      itemCurrency: priceMatch ? priceMatch[1] : null,
      itemUrl: itemUrl ? decodeXml(itemUrl) : null,
    });
  }

  return messages;
}

/**
 * Fetches inbound buyer messages created since `sinceISO` (ISO timestamp).
 * Never returns outbound messages — see the header comment for why none exist
 * in this response.
 */
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

    // Diagnostic, not an error: cheap ongoing signal that this page's
    // exchange blocks parsed as expected. Kept permanently (not just for the
    // 2026-08-26 investigation) since eBay changing this schema again would
    // otherwise silently zero out sync results the same way it did before.
    console.info(`[ebay/messages] GetMemberMessages page ${page}:`, {
      exchangeBlocks: exchangeBlocks.length,
      messagesParsed: pageMessages.length,
    });

    const [sample] = exchangeBlocks;
    if (sample) {
      // Every message in a thread with >1 message has been landing with the
      // exact same ebayCreatedAt (confirmed live 2026-08-27 across nearly
      // every multi-message thread) — the `?? new Date().toISOString()`
      // fallback on line below is firing for every message, meaning
      // <CreationDate> isn't actually inside <Question> the way it's
      // currently read. Logged unconditionally (not just on a parse
      // mismatch) because this failure is silent otherwise: the row still
      // "succeeds" per parseExchangeBlock's messageId/text guard, so nothing
      // else would ever surface it.
      console.info(`[ebay/messages] exchange structure (redacted, page ${page}):`, redactedStructure(sample));
    }
    if (sample && pageMessages.length < exchangeBlocks.length) {
      // Exchange blocks exist but some/all failed parseExchangeBlock's
      // messageId/text guard — the real XML nests differently than
      // parseExchangeBlock currently assumes. Log only TAG NAMES from one
      // sample block, never field content: a buyer's message text is
      // private and must not end up in server logs.
      const questionTagCount = (sample.match(/<Question>/g) ?? []).length;
      const tagsInFirstBlock = [
        ...new Set([...sample.matchAll(/<([A-Za-z][\w-]*)[ >]/g)].map((m) => m[1])),
      ];
      console.warn(
        `[ebay/messages] schema mismatch on page ${page}: ${exchangeBlocks.length} exchange block(s), only ${pageMessages.length} parsed`,
        { questionTagCount, tagsInFirstBlock }
      );
    }

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
