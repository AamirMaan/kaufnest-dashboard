import { Fragment } from "react";
import { formatDateTime } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/utils/currency";
import { avatarClassesFor, avatarInitial } from "../_lib/avatarColor";
import { dayLabelFor, isNewDay } from "../_lib/dayLabel";
import type { MessageThread } from "../_lib/groupThreads";
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
  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-(--color-text-muted)">
        Select a conversation
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-(--color-border) px-4 py-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarClassesFor(thread.buyerUsername)}`}
        >
          {avatarInitial(thread.buyerUsername)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-(--color-text-strong)">{thread.buyerUsername}</p>
          {thread.itemTitle ? (
            <div className="flex items-baseline gap-1.5">
              {thread.itemUrl ? (
                <a
                  href={thread.itemUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-xs text-(--color-primary-text) hover:underline"
                  title={thread.itemTitle}
                >
                  {thread.itemTitle}
                </a>
              ) : (
                <span className="truncate text-xs text-(--color-text-muted)" title={thread.itemTitle}>
                  {thread.itemTitle}
                </span>
              )}
              {thread.itemPrice !== null && (
                <span className="shrink-0 text-xs text-(--color-text-muted)">
                  {formatCurrency(thread.itemPrice, displayCurrency(thread.itemCurrency))}
                </span>
              )}
            </div>
          ) : (
            // Rows synced before migration 034 (or a response missing Item
            // details) — same fallback the header has always shown.
            <p className="truncate text-xs text-(--color-text-muted)">Item {thread.itemId}</p>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {thread.messages.map((message, index) => {
          // A Fragment (not a wrapper div, not display:contents) inserts the
          // optional day-separator and the bubble as genuine direct siblings
          // in the parent flex column — display:contents technically does
          // the same on paper, but its interaction with flex align-self has
          // a real cross-browser history of quirks, not worth the risk when
          // a Fragment sidesteps the question entirely by adding no DOM node.
          const previous = thread.messages[index - 1];
          const showDaySeparator = isNewDay(message.ebay_created_at, previous?.ebay_created_at ?? null);
          const needsReply = message.direction === "inbound" && !message.is_read;
          return (
            <Fragment key={message.id}>
              {showDaySeparator && (
                <div className="flex justify-center">
                  <span className="rounded-full bg-(--color-surface-subtle) px-3 py-1 text-xs font-medium text-(--color-text-muted)">
                    {dayLabelFor(message.ebay_created_at)}
                  </span>
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-(--radius-card) px-3.5 py-2.5 text-sm ${
                  message.direction === "outbound"
                    ? "self-end rounded-br-none bg-(--color-primary-muted) text-(--color-primary-text)"
                    : needsReply
                      ? "self-start rounded-bl-none border-l-4 border-(--color-warning) bg-(--color-warning-bg) text-(--color-text-strong)"
                      : "self-start rounded-bl-none bg-(--color-surface) text-(--color-text-strong)"
                }`}
                // Answered inbound bubbles need an explicit card treatment,
                // not just a background class: --color-surface-subtle (the
                // prior choice) is literally this page's own --background
                // token (globals.css), so the bubble was invisible against
                // it. --color-surface + the app's existing shadow-card
                // convention (StatCard, DataTable) makes it read as a
                // floating card instead, same as WhatsApp's white bubble
                // on a light gray page.
                style={
                  message.direction === "inbound" && !needsReply
                    ? { boxShadow: "var(--shadow-card)" }
                    : undefined
                }
              >
                <p className="whitespace-pre-wrap">{message.body}</p>
                <p className="mt-1 text-[10px] opacity-70">{formatDateTime(message.ebay_created_at)}</p>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
