"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

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

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const sent = await onSend(trimmed);
    if (sent) setText("");
  }

  return (
    <div className="border-t border-(--color-border) p-3">
      {disabled && disabledReason && (
        <p className="mb-2 text-xs text-(--color-text-muted)">{disabledReason}</p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled || sending}
          rows={2}
          placeholder="Write a reply…"
          className="flex-1 resize-none rounded-(--radius-input) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text-strong) disabled:opacity-60"
        />
        <Button size="sm" disabled={disabled || sending || !text.trim()} onClick={handleSend}>
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
