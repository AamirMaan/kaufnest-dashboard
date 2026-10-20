import { dispatcherOptions, dispatcherName } from "./dispatcherOptions";
import type { Profile } from "@/types";

function p(over: Partial<Profile>): Profile {
  return {
    id: "u",
    email: "u@x.com",
    full_name: "User",
    role: "admin",
    permission_overrides: [],
    status: "active",
    notifications_read_through: null,
    created_at: "2026-01-01",
    ...over,
  };
}

describe("dispatcherOptions", () => {
  const users = [
    p({ id: "a", full_name: "Zoe", role: "accountant" }),
    p({ id: "b", full_name: "Adam", role: "admin" }),
    p({ id: "c", full_name: "Gone", status: "deactivated" }),
    p({ id: "d", full_name: "", email: "noname@x.com" }),
  ];

  it("lists active users sorted by name, falling back to email", () => {
    expect(dispatcherOptions(users, null)).toEqual([
      { value: "b", label: "Adam" },
      { value: "d", label: "noname@x.com" },
      { value: "a", label: "Zoe" },
    ]);
  });

  it("keeps the current dispatcher even if deactivated", () => {
    expect(dispatcherOptions(users, "c")).toContainEqual({ value: "c", label: "Gone (deactivated)" });
  });

  it("labels an active current dispatcher whose role lacks Orders", () => {
    const withViewer = [...users, p({ id: "e", full_name: "Vic", role: "viewer" as Profile["role"] })];
    const opts = dispatcherOptions(withViewer, "e");
    expect(opts).toContainEqual({ value: "e", label: "Vic (no Orders access)" });
    expect(dispatcherOptions(withViewer, null).some((o) => o.value === "e")).toBe(false);
  });

  it("keeps a current dispatcher missing from users as 'Current dispatcher'", () => {
    expect(dispatcherOptions(users, "zzz")).toContainEqual({ value: "zzz", label: "Current dispatcher" });
  });
});

describe("dispatcherName", () => {
  it("resolves a name or null", () => {
    expect(dispatcherName([p({ id: "b", full_name: "Adam" })], "b")).toBe("Adam");
    expect(dispatcherName([], "b")).toBeNull();
    expect(dispatcherName([], null)).toBeNull();
  });
});
