import { interpretAction } from "./webhookActions";

const statusMap = { "list-done": "fixed", "list-doing": "in_progress" } as const;

describe("interpretAction", () => {
  it("reads a card move as a status change", () => {
    expect(
      interpretAction(
        {
          type: "updateCard",
          id: "a-1",
          data: { card: { id: "card-1" }, listAfter: { id: "list-done" } },
        },
        { ...statusMap }
      )
    ).toEqual({ kind: "status", cardId: "card-1", status: "fixed" });
  });

  it("falls back to in_progress for an unmapped list", () => {
    expect(
      interpretAction(
        { type: "updateCard", id: "a-2", data: { card: { id: "c" }, listAfter: { id: "unknown" } } },
        { ...statusMap }
      )
    ).toEqual({ kind: "status", cardId: "c", status: "in_progress" });
  });

  it("ignores a card edit that did not move lists", () => {
    expect(
      interpretAction(
        { type: "updateCard", id: "a-3", data: { card: { id: "c" }, old: { name: "before" } } },
        { ...statusMap }
      )
    ).toEqual({ kind: "ignore" });
  });

  it("reads an @customer comment as a reply", () => {
    expect(
      interpretAction(
        {
          type: "commentCard",
          id: "comment-9",
          data: { card: { id: "card-1" }, text: "@customer shipping a fix today" },
          memberCreator: { fullName: "Sam" },
        },
        { ...statusMap }
      )
    ).toEqual({
      kind: "reply",
      cardId: "card-1",
      commentId: "comment-9",
      body: "shipping a fix today",
      author: "Sam",
    });
  });

  it("ignores an internal comment", () => {
    expect(
      interpretAction(
        { type: "commentCard", id: "c-1", data: { card: { id: "x" }, text: "assigning to Sam" } },
        { ...statusMap }
      )
    ).toEqual({ kind: "ignore" });
  });

  it("ignores unrelated action types", () => {
    expect(
      interpretAction({ type: "addMemberToCard", id: "m-1", data: {} }, { ...statusMap })
    ).toEqual({ kind: "ignore" });
  });
});
