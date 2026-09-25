import { createCard, attachFile, fetchCard, downloadAttachment } from "./trello";
import type { TrelloEnv } from "./config";

const env: TrelloEnv = {
  key: "k", token: "t", secret: "s",
  boardId: "b", intakeListId: "list-intake",
  statusMap: {}, callbackUrl: "https://app.example.com/api/support/trello-webhook",
};

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function mockJson(body: unknown, ok = true, status = 200) {
  const fn = jest.fn().mockResolvedValue({
    ok, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("createCard", () => {
  it("posts to the intake list and returns id and short url", async () => {
    const fn = mockJson({ id: "card-1", shortUrl: "https://trello.com/c/abc" });

    const card = await createCard({ env, listId: "list-intake", name: "[t] Bug", desc: "body" });

    expect(card).toEqual({ id: "card-1", url: "https://trello.com/c/abc" });
    const [url, init] = fn.mock.calls[0];
    expect(url).toContain("https://api.trello.com/1/cards");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({ idList: "list-intake", name: "[t] Bug", desc: "body" });
  });

  it("throws a readable error when Trello rejects the call", async () => {
    mockJson({ message: "invalid id" }, false, 400);
    await expect(
      createCard({ env, listId: "nope", name: "x", desc: "y" })
    ).rejects.toThrow(/Trello createCard failed \(400\)/);
  });
});

describe("attachFile", () => {
  it("uploads multipart and returns attachment metadata", async () => {
    const fn = mockJson({ id: "att-1", name: "shot.png", mimeType: "image/png", bytes: 1234 });
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });

    const meta = await attachFile({ env, cardId: "card-1", file });

    expect(meta).toEqual({ id: "att-1", name: "shot.png", mime: "image/png", bytes: 1234 });
    const [url, init] = fn.mock.calls[0];
    expect(url).toContain("/1/cards/card-1/attachments");
    expect(init.body).toBeInstanceOf(FormData);
  });
});

describe("fetchCard", () => {
  it("returns the card's current list", async () => {
    mockJson({ idList: "list-done", shortUrl: "https://trello.com/c/abc" });
    await expect(fetchCard({ env, cardId: "card-1" })).resolves.toEqual({
      idList: "list-done",
      url: "https://trello.com/c/abc",
    });
  });
});

describe("downloadAttachment", () => {
  it("authenticates with the OAuth header, not query params", async () => {
    const fn = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
      headers: new Headers({ "content-type": "image/png" }),
    });
    global.fetch = fn as unknown as typeof fetch;

    const out = await downloadAttachment({
      env, cardId: "card-1", attachmentId: "att-1", fileName: "shot.png",
    });

    expect(out.contentType).toBe("image/png");
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe(
      "https://api.trello.com/1/cards/card-1/attachments/att-1/download/shot.png"
    );
    expect(url).not.toContain("key=");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'OAuth oauth_consumer_key="k", oauth_token="t"'
    );
  });
});
