/**
 * Deterministic per-username avatar color, hashed into a fixed 6-color
 * decorative palette (globals.css: --color-avatar-1..6) — same buyer always
 * gets the same color, distinct from the app's semantic success/warning/
 * danger/info tokens so an avatar is never mistaken for a status.
 *
 * Every possible return value is written out as a full, static string.
 * Tailwind's JIT scanner reads source text at build time, not runtime
 * values — a template-built class name like `bg-(--color-avatar-${n})`
 * would be invisible to it and silently generate no CSS (same reason
 * components/ui/Badge.tsx's VARIANT_CLASSES is a static lookup, not a
 * template string).
 */
const AVATAR_CLASSES = [
  "bg-(--color-avatar-1) text-(--color-avatar-1-text)",
  "bg-(--color-avatar-2) text-(--color-avatar-2-text)",
  "bg-(--color-avatar-3) text-(--color-avatar-3-text)",
  "bg-(--color-avatar-4) text-(--color-avatar-4-text)",
  "bg-(--color-avatar-5) text-(--color-avatar-5-text)",
  "bg-(--color-avatar-6) text-(--color-avatar-6-text)",
] as const;

/** djb2-style string hash — good enough distribution for a 6-bucket palette. */
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function avatarClassesFor(username: string): string {
  const index = hashString(username) % AVATAR_CLASSES.length;
  return AVATAR_CLASSES[index];
}

/** First letter of the username, uppercased. "?" for blank/whitespace-only input. */
export function avatarInitial(username: string): string {
  return username.trim().charAt(0).toUpperCase() || "?";
}
