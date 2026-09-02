"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState, type EditorOptions } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Bold as BoldIcon,
  Heading2,
  Heading3,
  Italic as ItalicIcon,
  List,
  ListOrdered,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { DraftFormState } from "../_lib/wizardValidation";

/* Extensions and editorProps live at module scope on purpose. `useEditor`
 * diffs its options object on every render (EditorInstanceManager.
 * compareOptions in @tiptap/react) and calls `editor.setOptions()` — which
 * re-runs `view.setProps()` + `view.updateState()` — whenever any value
 * differs by identity. A `StarterKit.configure({...})` call or an inline
 * `editorProps` literal is a brand-new object each render, so inlining them
 * would churn the ProseMirror view on every keystroke. */

/* Only what `sanitizeListingHtml` (src/lib/utils/sanitizeListingHtml.ts)
 * keeps, and only what the toolbar below can produce. Anything else the
 * seller manages to author is stripped server-side before it reaches eBay,
 * so offering it here would just be a lie:
 *  - blockquote / codeBlock / code / horizontalRule → not in ALLOWED_TAGS
 *  - strike (<s>) → not in ALLOWED_TAGS
 *  - link → <a> IS allowed by the sanitizer, but there is no link UI in this
 *    toolbar and the extension's click-to-open behaviour inside an editor is
 *    a trap; keep the surface to what the buttons can do.
 * StarterKit v3 ships no Image extension at all, so there is nothing to
 * disable for images. */
const EXTENSIONS = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    link: false,
    heading: { levels: [2, 3] },
  }),
];

const EDITOR_PROPS: EditorOptions["editorProps"] = {
  attributes: {
    class:
      "min-h-40 w-full px-3 py-2 text-sm text-(--color-text-strong) focus:outline-none " +
      "[&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 " +
      "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3",
  },
  /* THE ENTER GUARD, HALF ONE OF TWO. `ListingForm.tsx`'s <form> blocks
   * implicit Enter submission (Publish is its default submit button, so a
   * stray Enter would push a listing live to eBay) by preventDefault()-ing
   * Enter for every target except a <textarea> or a focused submit button.
   * This editor's contenteditable root is neither, so it would be caught by
   * that guard. Stopping propagation here means the form-level handler never
   * sees the event at all — the guard cannot interfere with ProseMirror's own
   * Enter handling (paragraph split / list item split), which is what
   * actually needs to run.
   *
   * Returning `false` is load-bearing: prosemirror-view's `someProp` consults
   * this direct prop FIRST and only continues on to the keymap plugins when
   * the handler returns a falsy value. Returning `true` here would swallow
   * Enter entirely and newlines would stop working.
   *
   * `ListingForm.tsx`'s guard also exempts `isContentEditable` targets as a
   * belt-and-braces second half — see the comment there for the iOS path
   * where ProseMirror defers its Enter handling and the real event is never
   * routed through this hook. */
  handleKeyDown: (_view, event) => {
    if (event.key === "Enter") event.stopPropagation();
    return false;
  },
};

interface Props {
  value: string;
  onChange: (html: string) => void;
  draft: DraftFormState;
  aiVisible: boolean;
  /** Called after any successful AI call so `AiUsageNote` can re-read usage. */
  onAiUsed?: () => void;
}

type AiMode = "generate" | "improve";

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      // Explicit type: this lives inside `ListingForm.tsx`'s <form>, where the
      // HTML default (submit) would publish the listing.
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-(--radius-btn) p-1.5 transition-colors cursor-pointer ${
        active
          ? "bg-(--color-surface-subtle) text-(--color-text-strong)"
          : "text-(--color-text-muted) hover:bg-(--color-surface-subtle) hover:text-(--color-text-base)"
      }`}
    >
      {children}
    </button>
  );
}

export function DescriptionEditor({ value, onChange, draft, aiVisible, onAiUsed }: Props) {
  const { success, error: toastError } = useToast();
  const [aiBusy, setAiBusy] = useState<AiMode | null>(null);
  /* A 429 from the AI routes is the one case where the controls stay visible
   * but go disabled with an explanation — unlike a plan/flag "no", which
   * hides them entirely. The message comes from the route body so the exact
   * limit is quoted. */
  const [quotaMessage, setQuotaMessage] = useState<string | null>(null);

  /* The editor is created once with whatever description the draft loaded
   * with; later parent-side changes are pushed in by the sync effect below.
   * Passing `value` straight to `content` would make the options object
   * differ on every keystroke (see the module-scope note above) without
   * actually re-parsing anything — `setOptions` never re-reads `content`.
   * A lazy `useState` initializer, not a ref: this value IS read during
   * render, which `react-hooks/refs` (correctly) forbids for refs. */
  const [initialContent] = useState(value);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: EXTENSIONS,
    content: initialContent,
    editorProps: EDITOR_PROPS,
    onUpdate: ({ editor }) => {
      // An "empty" ProseMirror doc still serializes to "<p></p>". Normalizing
      // it back to "" keeps `draft.description` falsy so the preview's empty
      // state, `scoreListing` and `toPayload()`'s `|| null` all behave.
      onChange(editor.isEmpty ? "" : editor.getHTML());
    },
  });

  const toolbar = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            bulletList: editor.isActive("bulletList"),
            orderedList: editor.isActive("orderedList"),
            h2: editor.isActive("heading", { level: 2 }),
            h3: editor.isActive("heading", { level: 3 }),
            empty: editor.isEmpty,
          }
        : null,
  });

  /* Pull external changes in (a draft row that finished loading, a reset).
   * Skipped while focused so it can never fight the user's cursor, and
   * skipped when the HTML already matches — which is the normal case, since
   * every local edit reaches `value` through `onUpdate` above. `emitUpdate:
   * false` stops this from echoing straight back out as a change. */
  useEffect(() => {
    if (!editor) return;
    if (editor.isFocused) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (current === value) return;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  const hasContent = value.trim().length > 0;

  async function runAi(mode: AiMode) {
    if (!editor || aiBusy) return;
    if (!draft.title.trim()) {
      toastError("Add a title first — the assistant writes the description from it.");
      return;
    }
    setAiBusy(mode);
    try {
      const res = await fetch("/api/listings/ai/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          title: draft.title,
          condition: draft.condition,
          categoryName: draft.category_name,
          aspects: draft.aspects,
          currentHtml: mode === "improve" ? editor.getHTML() : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 429) setQuotaMessage(json.error ?? "AI generations are used up for this month.");
        throw new Error(json.error ?? "The assistant could not write a description.");
      }
      const html = typeof json.html === "string" ? json.html.trim() : "";
      if (!html) {
        throw new Error("The assistant returned an empty description. Try again.");
      }
      // Only reached on a fully successful, non-empty response — the editor is
      // never partially overwritten by a failed call.
      setQuotaMessage(null);
      editor.commands.setContent(html);
      onAiUsed?.();
      success(mode === "generate" ? "Description written." : "Description improved.");
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "The assistant could not write a description."
      );
    } finally {
      setAiBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface) focus-within:ring-2 focus-within:ring-(--color-primary)">
        <div className="flex flex-wrap items-center gap-1 border-b border-(--color-border-subtle) px-2 py-1.5">
          <ToolbarButton
            label="Bold"
            active={!!toolbar?.bold}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <BoldIcon size={15} />
          </ToolbarButton>
          <ToolbarButton
            label="Italic"
            active={!!toolbar?.italic}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <ItalicIcon size={15} />
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-(--color-border-subtle)" />
          <ToolbarButton
            label="Bulleted list"
            active={!!toolbar?.bulletList}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List size={15} />
          </ToolbarButton>
          <ToolbarButton
            label="Numbered list"
            active={!!toolbar?.orderedList}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={15} />
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-(--color-border-subtle)" />
          <ToolbarButton
            label="Heading"
            active={!!toolbar?.h2}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 size={15} />
          </ToolbarButton>
          <ToolbarButton
            label="Subheading"
            active={!!toolbar?.h3}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 size={15} />
          </ToolbarButton>
        </div>

        {/* StarterKit ships no Placeholder extension, so the empty-state hint
          * is an overlay rather than a ProseMirror decoration — it must not
          * take part in layout or swallow the click that focuses the editor. */}
        <div className="relative">
          <EditorContent editor={editor} />
          {toolbar?.empty !== false && (
            <p className="pointer-events-none absolute top-2 left-3 text-sm text-(--color-text-faint)">
              Item details buyers will see on eBay
            </p>
          )}
        </div>
      </div>

      {aiVisible && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => runAi("generate")}
            disabled={!editor || aiBusy !== null || !!quotaMessage || !draft.title.trim()}
          >
            {aiBusy === "generate" ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Writing…
              </>
            ) : (
              <>
                <Sparkles size={14} /> Write with AI
              </>
            )}
          </Button>
          {hasContent && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => runAi("improve")}
              disabled={!editor || aiBusy !== null || !!quotaMessage || !draft.title.trim()}
            >
              {aiBusy === "improve" ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Improving…
                </>
              ) : (
                <>
                  <Sparkles size={14} /> Improve with AI
                </>
              )}
            </Button>
          )}
          {!draft.title.trim() && !quotaMessage && (
            <span className="text-xs text-(--color-text-faint)">
              Add a title first — the assistant writes from it.
            </span>
          )}
        </div>
      )}

      {aiVisible && quotaMessage && (
        <p className="text-xs text-(--color-warning-text)">{quotaMessage}</p>
      )}
    </div>
  );
}
