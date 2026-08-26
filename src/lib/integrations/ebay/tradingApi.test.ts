import { tradingApiCall } from "./tradingApi";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function mockXmlResponse(xml: string, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    text: () => Promise.resolve(xml),
  }) as unknown as typeof fetch;
}

describe("tradingApiCall", () => {
  it("returns the raw XML on Ack=Success", async () => {
    mockXmlResponse("<GetFooResponse><Ack>Success</Ack></GetFooResponse>");
    const xml = await tradingApiCall("GetFoo", "<GetFooRequest/>", "token");
    expect(xml).toBe("<GetFooResponse><Ack>Success</Ack></GetFooResponse>");
  });

  it("logs the raw response (truncated) before throwing on Ack=Failure, so the cause is visible without re-deploying", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockXmlResponse(
      "<GetFooResponse><Ack>Failure</Ack><Errors><ErrorCode>42</ErrorCode>" +
        "<LongMessage>Something eBay-specific went wrong</LongMessage></Errors></GetFooResponse>"
    );

    await expect(tradingApiCall("GetFoo", "<GetFooRequest/>", "token")).rejects.toThrow(
      /Something eBay-specific went wrong/
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("GetFoo"),
      expect.stringContaining("<ErrorCode>42</ErrorCode>")
    );
    errorSpy.mockRestore();
  });

  it("never logs the access token", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockXmlResponse("<GetFooResponse><Ack>Failure</Ack></GetFooResponse>");

    await expect(
      tradingApiCall("GetFoo", "<GetFooRequest/>", "super-secret-token-value")
    ).rejects.toThrow();

    for (const call of errorSpy.mock.calls) {
      expect(call.join(" ")).not.toContain("super-secret-token-value");
    }
    errorSpy.mockRestore();
  });

  it("truncates a very long failure body rather than logging it in full", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const longMessage = "x".repeat(2000);
    mockXmlResponse(
      `<GetFooResponse><Ack>Failure</Ack><Errors><LongMessage>${longMessage}</LongMessage></Errors></GetFooResponse>`
    );

    await expect(tradingApiCall("GetFoo", "<GetFooRequest/>", "token")).rejects.toThrow();

    const loggedXml = errorSpy.mock.calls[0][1] as string;
    expect(loggedXml.length).toBeLessThan(2000);
    errorSpy.mockRestore();
  });
});
