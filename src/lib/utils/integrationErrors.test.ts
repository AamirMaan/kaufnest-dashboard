import { integrationErrorMessage, INTEGRATION_ERRORS } from "./integrationErrors";

describe("integrationErrorMessage", () => {
  it("maps a known code to its copy", () => {
    expect(integrationErrorMessage("INTEGRATION_ACCOUNT_LIMIT", "x")).toBe(INTEGRATION_ERRORS.INTEGRATION_ACCOUNT_LIMIT);
  });
  it("tells the admin to disconnect, not pause, when adding hits the cap", () => {
    expect(INTEGRATION_ERRORS.INTEGRATION_ACCOUNT_LIMIT).not.toMatch(/pause or/i);
    expect(INTEGRATION_ERRORS.INTEGRATION_ACCOUNT_LIMIT).toMatch(/disconnect an account/i);
    expect(INTEGRATION_ERRORS.INTEGRATION_RESUME_LIMIT).toMatch(/pause another/i);
  });
  it("falls back for unknown or missing codes", () => {
    expect(integrationErrorMessage("SOMETHING_ELSE", "fallback")).toBe("fallback");
    expect(integrationErrorMessage(undefined, "fallback")).toBe("fallback");
  });
  it("ignores inherited Object.prototype keys", () => {
    expect(integrationErrorMessage("toString", "fallback")).toBe("fallback");
  });
});
