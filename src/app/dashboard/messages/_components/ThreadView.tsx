"use client";

import { Fragment, useEffect, useRef } from "react";
import { CheckCheck, ExternalLink } from "lucide-react";
import { formatCurrency } from "@/lib/utils/currency";
import { avatarClassesFor, avatarInitial } from "../_lib/avatarColor";
import { dayLabelFor, isNewDay, timeLabelFor } from "../_lib/dayLabel";
import type { MessageThread } from "../_lib/groupThreads";
import { cleanMessageBody } from "../_lib/messageBody";
import type { Currency } from "@/types";

interface Props {
  thread: MessageThread | null;
}

// formatCurrency needs the app's narrow Currency union; eBay's currencyID
// could in principle be any ISO code. Every currently-connected tenant is
// EU-based, so falling back to EUR for DISPLAY only (the raw stored
// item_currency is untouched) is a reasonable default rather than crashing
// or requiring a wider Currency type for one rarely-exercised edge.
const KNOWN_CURRENCIES: readonly string[] = ["EUR", "USD", "GBP"] satisfies readonly Currency[];
function displayCurrency(itemCurrency: string | null): Currency {
  return itemCurrency && KNOWN_CURRENCIES.includes(itemCurrency) ? (itemCurrency as Currency) : "EUR";
}

export function ThreadView({ thread }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const threadKey = thread?.key ?? null;
  const messageCount = thread?.messages.length ?? 0;

  // Open each conversation at its newest message (chat-app convention), and
  // follow new messages as they arrive (a sent reply, a sync).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [threadKey, messageCount]);

  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-(--color-text-muted)">
        Select a conversation
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-3 border-b border-(--color-border) px-5 py-4">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarClassesFor(thread.buyerUsername)}`}
        >
          {avatarInitial(thread.buyerUsername)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-(--color-text-strong)">{thread.buyerUsername}</p>
          {thread.itemTitle ? (
            <p className="flex items-baseline gap-1.5 text-sm text-(--color-text-muted)">
              <span className="truncate" title={thread.itemTitle}>{thread.itemTitle}</span>
              {thread.itemPrice !== null && (
                <span className="shrink-0">
                  · {formatCurrency(thread.itemPrice, displayCurrency(thread.itemCurrency))}
                </span>
              )}
            </p>
          ) : (
            // Rows synced before migration 034 (or a response missing Item
            // details) — same fallback the header has always shown.
            <p className="truncate text-sm text-(--color-text-muted)">Item {thread.itemId}</p>
          )}
        </div>
        {thread.itemUrl && (
          <a
            href={thread.itemUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View listing on eBay"
            title="View listing on eBay"
            className="shrink-0 rounded-[var(--radius-btn)] p-2 text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle) hover:text-(--color-text-strong)"
          >
            <ExternalLink size={20} />
          </a>
        )}
      </div>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {thread.messages.map((message, index) => {
          // A Fragment (not a wrapper div, not display:contents) inserts the
          // optional day-separator and the bubble as genuine direct siblings
          // in the parent flex column — display:contents technically does
          // the same on paper, but its interaction with flex align-self has
          // a real cross-browser history of quirks, not worth the risk when
          // a Fragment sidesteps the question entirely by adding no DOM node.
          const previous = thread.messages[index - 1];
          const showDaySeparator = isNewDay(message.ebay_created_at, previous?.ebay_created_at ?? null);
          const outbound = message.direction === "outbound";
          const needsReply = !outbound && !message.is_read;
          return (
            <Fragment key={message.id}>
              {showDaySeparator && (
                <div className="my-2 flex items-center gap-4" role="separator">
                  <span className="h-px flex-1 bg-(--color-border)" />
                  <span className="text-xs font-medium uppercase tracking-wider text-(--color-text-muted)">
                    {dayLabelFor(message.ebay_created_at)}
                  </span>
                  <span className="h-px flex-1 bg-(--color-border)" />
                </div>
              )}
              <div className={`flex max-w-[75%] flex-col ${outbound ? "items-end self-end" : "items-start self-start"}`}>
                {/* Inbound uses --color-surface-subtle: the chat card is
                    --color-surface, so it reads as a soft gray bubble (it was
                    invisible back when the pane sat on the page background).
                    Needs-reply is flagged by the pill under the bubble, not a
                    loud tint — most synced threads are unanswered. */}
                <div
                  className={`rounded-3xl px-5 py-3 text-sm leading-relaxed break-words ${
                    outbound
                      ? "bg-(--color-primary) text-white"
                      : "bg-(--color-surface-subtle) text-(--color-text-strong)"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{cleanMessageBody(message.body)}</p>
                </div>
                <p className="mt-1 flex items-center gap-1 px-1.5 text-xs text-(--color-text-muted)">
                  {timeLabelFor(message.ebay_created_at)}
                  {needsReply && (
                    <span className="ml-1 rounded-full bg-(--color-warning-bg) px-2 py-0.5 text-[11px] font-medium text-(--color-warning)">
                      Needs reply
                    </span>
                  )}
                  {outbound && <CheckCheck size={14} aria-label="Sent" className="text-(--color-primary)" />}
                </p>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
