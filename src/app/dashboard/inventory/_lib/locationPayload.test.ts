import { locationPayload } from "./locationPayload";

describe("locationPayload", () => {
  it("omits dispatcher_id when unchanged (pre-057 tenants have no such column)", () => {
    expect(locationPayload({ name: " Main ", type: "own", dispatcherId: "", current: null })).toEqual({
      name: "Main",
      type: "own",
    });
    expect(
      locationPayload({ name: "Main", type: "own", dispatcherId: "u1", current: { dispatcher_id: "u1" } })
    ).not.toHaveProperty("dispatcher_id");
  });

  it("includes a newly picked dispatcher", () => {
    expect(locationPayload({ name: "Main", type: "own", dispatcherId: "u2", current: { dispatcher_id: "u1" } })).toEqual({
      name: "Main",
      type: "own",
      dispatcher_id: "u2",
    });
    expect(locationPayload({ name: "New", type: "own", dispatcherId: "u2", current: null })).toHaveProperty(
      "dispatcher_id",
      "u2"
    );
  });

  it("clears the dispatcher when switched to dropship", () => {
    expect(
      locationPayload({ name: "Sup", type: "dropship", dispatcherId: "u1", current: { dispatcher_id: "u1" } })
    ).toEqual({ name: "Sup", type: "dropship", dispatcher_id: null });
  });

  it("omits dispatcher_id for dropship with no dispatcher", () => {
    expect(
      locationPayload({ name: "Sup", type: "dropship", dispatcherId: "u1", current: { dispatcher_id: null } })
    ).not.toHaveProperty("dispatcher_id");
    expect(locationPayload({ name: "Sup", type: "dropship", dispatcherId: "", current: null })).not.toHaveProperty(
      "dispatcher_id"
    );
  });

  it("includes an explicit clear back to None", () => {
    expect(
      locationPayload({ name: "Main", type: "own", dispatcherId: "", current: { dispatcher_id: "u1" } })
    ).toHaveProperty("dispatcher_id", null);
  });

  it("treats a location with no dispatcher_id field (pre-057 row) as none", () => {
    expect(locationPayload({ name: "Main", type: "own", dispatcherId: "", current: {} })).not.toHaveProperty(
      "dispatcher_id"
    );
  });
});
