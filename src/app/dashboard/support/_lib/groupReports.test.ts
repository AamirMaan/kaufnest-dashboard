import { groupByStatus, STATUS_COLUMNS, STATUS_LABELS } from "./groupReports";
import type { BugReport } from "@/types";

const at = (id: string, status: BugReport["status"], created_at: string) =>
  ({ id, status, created_at }) as BugReport;

describe("groupByStatus", () => {
  it("returns a key for every column, even empty ones", () => {
    const grouped = groupByStatus([]);
    expect(Object.keys(grouped).sort()).toEqual([...STATUS_COLUMNS].sort());
    expect(grouped.reported).toEqual([]);
  });

  it("files each report under its status", () => {
    const grouped = groupByStatus([
      at("a", "reported", "2026-09-01T00:00:00Z"),
      at("b", "fixed", "2026-09-02T00:00:00Z"),
    ]);
    expect(grouped.reported.map((r) => r.id)).toEqual(["a"]);
    expect(grouped.fixed.map((r) => r.id)).toEqual(["b"]);
  });

  it("sorts each column newest first", () => {
    const grouped = groupByStatus([
      at("older", "reported", "2026-09-01T00:00:00Z"),
      at("newer", "reported", "2026-09-09T00:00:00Z"),
    ]);
    expect(grouped.reported.map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("labels every column", () => {
    for (const status of STATUS_COLUMNS) {
      expect(STATUS_LABELS[status]).toBeTruthy();
    }
  });
});
