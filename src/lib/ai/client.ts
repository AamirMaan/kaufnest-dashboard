import Anthropic from "@anthropic-ai/sdk";

/** Server-only. Never import from a "use client" file. */
export const anthropic = new Anthropic();

export const AI_MODEL = "claude-opus-5";

/** Description writing and aspect extraction are short structured tasks, not
 * reasoning problems — low effort is the cost lever that costs no quality. */
export const AI_EFFORT = "low" as const;
