import { supportSlice, fetchReports, submitReport } from "./supportSlice";
import type { BugReport } from "@/types";

const { reducer, actions } = supportSlice;

function report(overrides: Partial<BugReport> = {}): BugReport {
  return {
    id: "r-1", tenant_id: "t-1", reporter_user_id: "u-1", reporter_email: "a@b.c",
    type: "bug", severity: "normal", title: "Broken", description: "It broke badly",
    status: "reported", page_url: null, context: null, attachments: [],
    trello_card_id: "card-1", trello_card_url: "https://trello.com/c/x",
    created_at: "2026-09-14T10:00:00Z", updated_at: "2026-09-14T10:00:00Z",
    last_synced_at: null, replies: [],
    ...overrides,
  };
}

describe("supportSlice", () => {
  it("starts empty and unloaded", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state).toMatchObject({ items: [], loaded: false, isFetching: false });
  });

  it("stores reports on a successful fetch", () => {
    const state = reducer(undefined, {
      type: fetchReports.fulfilled.type,
      payload: [report(), report({ id: "r-2" })],
    });
    expect(state.items).toHaveLength(2);
    expect(state.loaded).toBe(true);
    expect(state.isFetching).toBe(false);
  });

  it("marks fetching while the request is in flight", () => {
    const state = reducer(undefined, { type: fetchReports.pending.type });
    expect(state.isFetching).toBe(true);
  });

  it("records the error message on a failed fetch and stops fetching", () => {
    const state = reducer(undefined, {
      type: fetchReports.rejected.type,
      error: { message: "Could not load your reports." },
    });
    expect(state.error).toBe("Could not load your reports.");
    expect(state.isFetching).toBe(false);
  });

  it("puts a newly submitted report at the top of the list", () => {
    const existing = reducer(undefined, {
      type: fetchReports.fulfilled.type,
      payload: [report({ id: "old", created_at: "2026-09-01T10:00:00Z" })],
    });
    const state = reducer(existing, {
      type: submitReport.fulfilled.type,
      payload: { report: report({ id: "new" }) },
    });
    expect(state.items[0].id).toBe("new");
    expect(state.items).toHaveLength(2);
  });

  it("tracks the selected report id", () => {
    const state = reducer(undefined, actions.selectReport("r-9"));
    expect(state.selectedId).toBe("r-9");
  });

  it("clears the selection", () => {
    const selected = reducer(undefined, actions.selectReport("r-9"));
    expect(reducer(selected, actions.selectReport(null)).selectedId).toBeNull();
  });
});
