export interface DescribeInput {
  mode: "generate" | "improve";
  title: string;
  condition: string;
  categoryName: string;
  aspects: Record<string, string>;
  currentHtml?: string;
}

export const DESCRIBE_SYSTEM_PROMPT = `You write eBay item descriptions for third-party sellers.

Output rules:
- Return ONLY an HTML fragment. No markdown, no code fences, no commentary.
- Permitted tags: <p>, <br>, <strong>, <em>, <ul>, <ol>, <li>, <h2>, <h3>.
- Never emit <script>, <style>, <iframe>, <form>, or any on* attribute — eBay rejects active content.
- Never emit inline styles, tables, or fixed widths. Most eBay buyers are on mobile.

Content rules:
- Lead with one short paragraph covering what the item is and who it suits.
- Follow with a bulleted list of concrete specifications.
- Close with a short paragraph on condition and what is included in the box.
- State only what the seller's data supports. Never invent measurements, model numbers, compatibility or warranty terms.
- No shipping, returns or payment claims — those come from the seller's eBay policies, and a contradiction here creates a dispute.
- Plain, factual British English. No hype, no exclamation marks, no "must-have".`;

export const ASPECTS_SYSTEM_PROMPT = `You extract eBay item specifics from a product listing.

You receive a title, a description, and up to four product photos. Return a value for each requested aspect.

Rules:
- Return an empty string for any aspect you cannot determine with confidence from the evidence given.
- Never guess a brand, model number, or size. A wrong item specific gets a listing demoted or removed, which is far worse for the seller than a blank field.
- Use the exact spelling and capitalisation a manufacturer would use.
- Values must be short — a word or two, not a sentence.`;

/**
 * JSON schema for structured output, built from the aspect names eBay's
 * Taxonomy API says this category requires. `additionalProperties: false`
 * means the model physically cannot return an aspect eBay did not ask for.
 */
export function buildAspectSchema(requiredAspectNames: string[]): object {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const name of requiredAspectNames) {
    properties[name] = {
      type: "string",
      description: `Value for the eBay item specific "${name}", or an empty string if it cannot be determined.`,
    };
  }

  return {
    type: "object",
    properties,
    required: [...requiredAspectNames],
    additionalProperties: false,
  };
}

export function buildDescribeUserPrompt(input: DescribeInput): string {
  const aspectLines = Object.entries(input.aspects)
    .filter(([, value]) => value.trim())
    .map(([name, value]) => `- ${name}: ${value}`)
    .join("\n");

  const parts = [
    `Title: ${input.title}`,
    `Category: ${input.categoryName || "(not set)"}`,
    `Condition: ${input.condition}`,
    aspectLines ? `Item specifics:\n${aspectLines}` : "Item specifics: (none provided)",
  ];

  if (input.mode === "improve" && input.currentHtml) {
    parts.push(
      `\nRewrite the seller's existing description below. Keep every fact it states; improve structure, completeness and clarity.\n\n${input.currentHtml}`
    );
  } else {
    parts.push("\nWrite a new description for this item.");
  }

  return parts.join("\n");
}
