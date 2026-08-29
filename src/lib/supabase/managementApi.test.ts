import { addExposedSchema } from "./managementApi";

function jsonResponse(dbSchema: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => ({ db_schema: dbSchema }),
    text: async () => JSON.stringify({ db_schema: dbSchema }),
  } as unknown as Response;
}

function isPatch(init?: RequestInit): boolean {
  return init?.method === "PATCH";
}

describe("addExposedSchema", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.SUPABASE_ACCESS_TOKEN = "test-token";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://testref.supabase.co";
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
    delete process.env.SUPABASE_ACCESS_TOKEN;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("returns without ever PATCHing when the schema is already exposed on the first read", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("public,tenant_existing"));

    await addExposedSchema("tenant_existing");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isPatch(fetchMock.mock.calls[0][1])).toBe(false);
  });

  it("verifies the final attempt's PATCH instead of false-negative failing (regression for the off-by-one bug)", async () => {
    // Not present on GETs 1-4 (each followed by a PATCH); only the 5th GET —
    // the extra verification read after the loop — reports it present. Under
    // the old code there was no 5th read, so this exact sequence used to
    // throw even though the last PATCH had actually stuck.
    let getCount = 0;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (isPatch(init)) {
        return Promise.resolve(jsonResponse("public,tenant_new"));
      }
      getCount++;
      const present = getCount >= 5;
      return Promise.resolve(jsonResponse(present ? "public,tenant_new" : "public"));
    });

    const promise = addExposedSchema("tenant_new");
    // 4 sleeps of POSTGREST_RELOAD_MS (2000ms) happen between loop attempts.
    for (let i = 0; i < 4; i++) {
      await jest.advanceTimersByTimeAsync(2000);
    }

    await expect(promise).resolves.toBeUndefined();
    expect(getCount).toBe(5);
    const patchCalls = fetchMock.mock.calls.filter(([, init]) => isPatch(init));
    expect(patchCalls).toHaveLength(4);
  });

  it("throws after exhausting all attempts (including the final verification read) when the schema never appears", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (isPatch(init)) {
        return Promise.resolve(jsonResponse("public"));
      }
      return Promise.resolve(jsonResponse("public"));
    });

    // Attach the rejection assertion synchronously, before advancing timers,
    // so the rejection is never briefly "unhandled" while fake timers flush
    // the loop's later iterations.
    const assertion = expect(addExposedSchema("tenant_never")).rejects.toThrow(
      'Failed to expose schema "tenant_never" after 4 attempts — a concurrent provision may be repeatedly overwriting the exposed-schema list'
    );
    for (let i = 0; i < 4; i++) {
      await jest.advanceTimersByTimeAsync(2000);
    }
    await assertion;
    // 4 GETs in the loop + 1 final verification GET + 4 PATCHes.
    const getCalls = fetchMock.mock.calls.filter(([, init]) => !isPatch(init));
    const patchCalls = fetchMock.mock.calls.filter(([, init]) => isPatch(init));
    expect(getCalls).toHaveLength(5);
    expect(patchCalls).toHaveLength(4);
  });

  it("throws immediately if SUPABASE_ACCESS_TOKEN is not set", async () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;

    await expect(addExposedSchema("tenant_x")).rejects.toThrow(
      "SUPABASE_ACCESS_TOKEN is not set — required to expose new tenant schemas"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
