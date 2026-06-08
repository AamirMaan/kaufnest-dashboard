import { usersSlice, hydrateUsers, addUser, updateUserRole } from "./usersSlice";
import type { Profile } from "@/types";

const makeProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: "user-1",
  email: "user@example.com",
  full_name: "Test User",
  role: "accountant",
  created_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("usersSlice", () => {
  const { reducer } = usersSlice;

  it("starts empty with loaded=false", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it("hydrates users", () => {
    const users = [makeProfile(), makeProfile({ id: "user-2", email: "b@b.com" })];
    const state = reducer(undefined, hydrateUsers(users));
    expect(state.items).toHaveLength(2);
    expect(state.loaded).toBe(true);
  });

  it("appends a new user via addUser", () => {
    const initial = reducer(undefined, hydrateUsers([makeProfile({ id: "user-1" })]));
    const newUser = makeProfile({ id: "user-2", email: "new@new.com", role: "admin" });
    const state = reducer(initial, addUser(newUser));
    expect(state.items).toHaveLength(2);
    expect(state.items[1].id).toBe("user-2");
  });

  it("updates a user's role via updateUserRole", () => {
    const initial = reducer(undefined, hydrateUsers([makeProfile({ id: "u1", role: "accountant" })]));
    const state = reducer(initial, updateUserRole({ id: "u1", role: "admin" }));
    expect(state.items[0].role).toBe("admin");
  });

  it("does nothing on updateUserRole when id not found", () => {
    const initial = reducer(undefined, hydrateUsers([makeProfile({ role: "accountant" })]));
    const state = reducer(initial, updateUserRole({ id: "missing", role: "admin" }));
    expect(state.items[0].role).toBe("accountant");
  });

  it("promotes to super_admin", () => {
    const initial = reducer(undefined, hydrateUsers([makeProfile({ id: "u1", role: "admin" })]));
    const state = reducer(initial, updateUserRole({ id: "u1", role: "super_admin" }));
    expect(state.items[0].role).toBe("super_admin");
  });

  it("demotes from admin to accountant", () => {
    const initial = reducer(undefined, hydrateUsers([makeProfile({ id: "u1", role: "admin" })]));
    const state = reducer(initial, updateUserRole({ id: "u1", role: "accountant" }));
    expect(state.items[0].role).toBe("accountant");
  });
});
