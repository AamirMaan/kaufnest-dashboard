import { assertReportVisible, attachReplies } from "./authorizeReport";
import type { BugReport, BugReportReply } from "@/types";

const report = { id: "r-1", tenant_id: "t-1" } as BugReport;

describe("assertReportVisible", () => {
  it("allows a report belonging to the caller's tenant", () => {
    expect(assertReportVisible(report, "t-1")).toBe(true);
  });

  it("denies a report belonging to another tenant", () => {
    expect(assertReportVisible(report, "t-2")).toBe(false);
  });

  it("denies when the report is missing", () => {
    expect(assertReportVisible(null, "t-1")).toBe(false);
  });
});

describe("attachReplies", () => {
  it("groups replies onto their report, oldest first", () => {
    const reports = [{ id: "r-1" }, { id: "r-2" }] as BugReport[];
    const replies = [
      { id: "x", report_id: "r-1", body: "later", author: null, created_at: "2026-09-10T10:00:00Z" },
      { id: "y", report_id: "r-1", body: "earlier", author: null, created_at: "2026-09-09T10:00:00Z" },
    ] as BugReportReply[];

    const out = attachReplies(reports, replies);

    expect(out[0].replies?.map((r) => r.body)).toEqual(["earlier", "later"]);
    expect(out[1].replies).toEqual([]);
  });
});
