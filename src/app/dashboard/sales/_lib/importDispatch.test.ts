import { importDispatchFields } from "./importDispatch";

describe("importDispatchFields", () => {
  it("suppresses dispatch notifications when any location has a dispatcher (057 applied)", () => {
    expect(importDispatchFields([{ dispatcher_id: null }, { dispatcher_id: "u1" }])).toEqual({ dispatch_suppressed: true });
  });

  it("omits the key when no location has a dispatcher (pre-057 tenants would reject it)", () => {
    expect(importDispatchFields([{ dispatcher_id: null }])).toEqual({});
    expect(importDispatchFields([{}])).toEqual({});
    expect(importDispatchFields([])).toEqual({});
  });
});
