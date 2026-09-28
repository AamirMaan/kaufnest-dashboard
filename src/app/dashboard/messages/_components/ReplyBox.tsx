"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Loader2, SendHorizontal } from "lucide-react";

interface Props {
  disabled: boolean;
  disabledReason?: string;
  sending: boolean;
  // Resolves true on success, false on failure — the text is only cleared
  // on success so a failed send never loses what was typed.
  onSend: (text: string) => Promise<boolean>;
}

export function ReplyBox({ disabled, disabledReason, sending, onSend }: Props) {
  const [text, setText] = useState("");
  const isFormValid = !disabled && text.trim().length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const sent = await onSend(trimmed);
    if (sent) setText("");
  }

  // Enter sends, Shift+Enter keeps a newline (chat convention). Skipped
  // mid-IME-composition so confirming a composed character doesn't send.
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div className="border-t border-(--color-border) px-5 py-4">
      {disabled && disabledReason && (
        <p className="mb-2 text-xs text-(--color-text-muted)">{disabledReason}</p>
      )}
      <form id="message-reply-form" onSubmit={handleSubmit} className="flex items-end gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || sending}
          required
          rows={1}
          placeholder="Type a reply…"
          aria-label="Reply"
          className="max-h-40 min-h-11 flex-1 resize-none field-sizing-content rounded-[var(--radius-btn)] border border-(--color-border) bg-(--color-surface) px-4 py-2.5 text-sm text-(--color-text-strong) placeholder:text-(--color-text-muted) focus:outline-none focus:ring-2 focus:ring-(--color-primary) disabled:opacity-60"
        />
        <button
          type="submit"
          form="message-reply-form"
          disabled={sending || !isFormValid}
          aria-label={sending ? "Sending…" : "Send reply"}
          title={sending ? "Sending…" : "Send reply"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-btn)] bg-(--color-primary) text-white transition-colors hover:bg-(--color-primary-hover) disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {sending ? <Loader2 size={18} className="animate-spin" /> : <SendHorizontal size={18} />}
        </button>
      </form>
    </div>
  );
}
