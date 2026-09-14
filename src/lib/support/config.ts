import type { BugReportStatus } from "@/types";

/**
 * Trello configuration, all env, none in the DB.
 * Server-only — never import this from a "use client" file.
 */
export interface TrelloEnv {
  key: string;
  token: string;
  secret: string;
  boardId: string;
  intakeListId: string;
  statusMap: Record<string, BugReportStatus>;
  callbackUrl: string;
}

const KNOWN_STATUSES: BugReportStatus[] = ["reported", "in_progress", "fixed", "wont_fix"];

/**
 * A Trello list this app has never heard of maps to `in_progress`, not an
 * error: the support team must be free to reorganise the board without
 * breaking what customers see.
 */
export const FALLBACK_STATUS: BugReportStatus = "in_progress";

export function parseStatusMap(raw: string | undefined): Record<string, BugReportStatus> {
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};

  const out: Record<string, BugReportStatus> = {};
  for (const [listId, status] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof status === "string" && KNOWN_STATUSES.includes(status as BugReportStatus)) {
      out[listId] = status as BugReportStatus;
    }
  }
  return out;
}

export function statusForList(
  listId: string,
  map: Record<string, BugReportStatus>
): BugReportStatus {
  return map[listId] ?? FALLBACK_STATUS;
}

export function listIdForStatus(
  status: BugReportStatus,
  map: Record<string, BugReportStatus>
): string | null {
  const found = Object.entries(map).find(([, value]) => value === status);
  return found ? found[0] : null;
}

/** Throws if a required variable is missing — a route returning 500 with a
 *  clear server log beats silently posting to the wrong board. */
export function trelloEnv(): TrelloEnv {
  const required = {
    key: process.env.TRELLO_API_KEY,
    token: process.env.TRELLO_API_TOKEN,
    secret: process.env.TRELLO_API_SECRET,
    boardId: process.env.TRELLO_BOARD_ID,
    intakeListId: process.env.TRELLO_INTAKE_LIST_ID,
    callbackUrl: process.env.TRELLO_WEBHOOK_CALLBACK_URL,
  };

  for (const [name, value] of Object.entries(required)) {
    if (!value) throw new Error(`Trello config missing: ${name}`);
  }

  return {
    key: required.key!,
    token: required.token!,
    secret: required.secret!,
    boardId: required.boardId!,
    intakeListId: required.intakeListId!,
    callbackUrl: required.callbackUrl!,
    statusMap: parseStatusMap(process.env.TRELLO_LIST_STATUS_MAP),
  };
}
