import { integrationErrorMessage, INTEGRATION_ERRORS } from "./integrationErrors";

describe("integrationErrorMessage", () => {
  it("maps a known code to its copy", () => {
    expect(integrationErrorMessage("INTEGRATION_ACCOUNT_LIMIT", "x")).toBe(INTEGRATION_ERRORS.INTEGRATION_ACCOUNT_LIMIT);
  });
  it("falls back for unknown or missing codes", () => {
    expect(integrationErrorMessage("SOMETHING_ELSE", "fallback")).toBe("fallback");
    expect(integrationErrorMessage(undefined, "fallback")).toBe("fallback");
  });
  it("ignores inherited Object.prototype keys", () => {
    expect(integrationErrorMessage("toString", "fallback")).toBe("fallback");
  });
});
