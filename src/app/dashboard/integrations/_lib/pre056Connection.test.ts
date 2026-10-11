import { withPre056Defaults } from "./pre056Connection";

describe("withPre056Defaults", () => {
  it("fills 056's columns with the values the migration gives existing rows", () => {
    const row = {
      id: "c1",
      platform: "ebay" as const,
      status: "connected" as const,
      external_account_id: null,
      marketplace_id: "EBAY_DE",
      last_synced_at: null,
      last_sync_status: null,
      last_sync_error: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    expect(withPre056Defaults(row)).toEqual({ ...row, external_username: null, display_name: null, is_active: true });
  });
});
