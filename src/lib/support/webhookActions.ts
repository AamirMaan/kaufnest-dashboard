import type { BugReportStatus } from "@/types";
import { statusForList } from "./config";
import { parseCustomerReply } from "./cardContent";

export interface TrelloAction {
  type: string;
  id: string;
  data: {
    card?: { id: string };
    listAfter?: { id: string };
    text?: string;
    old?: Record<string, unknown>;
  };
  memberCreator?: { fullName?: string };
}

export type InterpretedAction =
  | { kind: "status"; cardId: string; status: BugReportStatus }
  | { kind: "reply"; cardId: string; commentId: string; body: string; author: string | null }
  | { kind: "ignore" };

/**
 * Trello sends far more action types than this feature cares about, and
 * redelivers them. Anything unrecognised is `ignore` — the route answers 200
 * so Trello stops retrying.
 */
export function interpretAction(
  action: TrelloAction,
  statusMap: Record<string, BugReportStatus>
): InterpretedAction {
  const cardId = action.data.card?.id;
  if (!cardId) return { kind: "ignore" };

  if (action.type === "updateCard" && action.data.listAfter?.id) {
    return { kind: "status", cardId, status: statusForList(action.data.listAfter.id, statusMap) };
  }

  if (action.type === "commentCard" && typeof action.data.text === "string") {
    const body = parseCustomerReply(action.data.text);
    if (!body) return { kind: "ignore" };
    return {
      kind: "reply",
      cardId,
      commentId: action.id,
      body,
      author: action.memberCreator?.fullName ?? null,
    };
  }

  return { kind: "ignore" };
}
