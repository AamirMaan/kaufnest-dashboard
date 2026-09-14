import type { BugReportType, BugSeverity } from "@/types";

/**
 * A Trello comment is shown to the customer only when it starts with this
 * marker. Everything else on the card is internal triage chatter.
 */
export const CUSTOMER_MARKER = "@customer";

export interface CardDescriptionInput {
  description: string;
  type: BugReportType;
  severity: BugSeverity;
  tenantSlug: string;
  plan: string;
  reporterEmail: string;
  pageUrl: string | null;
  userAgent: string | null;
}

export function renderCardTitle(tenantSlug: string, title: string): string {
  return `[${tenantSlug}] ${title}`;
}

/** The card body a triager reads. User's words first, context underneath. */
export function renderCardDescription(input: CardDescriptionInput): string {
  const lines = [
    input.description.trim(),
    "",
    "---",
    `**Tenant:** ${input.tenantSlug} (${input.plan})`,
    `**Reporter:** ${input.reporterEmail}`,
    `**Type:** ${input.type} / **Severity:** ${input.severity}`,
  ];

  if (input.pageUrl) lines.push(`**Page:** ${input.pageUrl}`);
  if (input.userAgent) lines.push(`**Browser:** ${input.userAgent}`);

  lines.push("", "_Reported from Boughtopia. Reply with `@customer …` to answer the reporter._");

  return lines.join("\n");
}

/** Returns the customer-visible body, or null if the comment is internal. */
export function parseCustomerReply(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith(CUSTOMER_MARKER)) return null;

  const body = trimmed.slice(CUSTOMER_MARKER.length).trim();
  return body.length > 0 ? body : null;
}
