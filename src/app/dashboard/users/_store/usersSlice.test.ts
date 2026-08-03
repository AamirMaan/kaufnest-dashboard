import { usersSlice, hydrateUsers, addUser, updateUser, updateUserRole } from "./usersSlice";
import { pageRangeLabel } from "@/components/ui/Pagination";
import type { Profile } from "@/types";

const makeProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: "user-1",
  email: "user@example.com",
  full_name: "Test User",
  role: "accountant",
  permission_overrides: [],
  status: "active",
  notifications_read_through: null,
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

  it("does not duplicate an existing user via addUser", () => {
    const initial = reducer(undefined, hydrateUsers([makeProfile({ id: "user-1" })]));
    const duplicate = makeProfile({ id: "user-1", role: "admin" });
    const state = reducer(initial, addUser(duplicate));
    expect(state.items).toHaveLength(1);
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

  it("updates a user's permission_overrides via updateUser (used by the Permissions modal)", () => {
    const initial = reducer(
      undefined,
      hydrateUsers([makeProfile({ id: "u1", role: "accountant", permission_overrides: [] })])
    );
    const updated = makeProfile({ id: "u1", role: "accountant", permission_overrides: ["delete_sale"] });
    const state = reducer(initial, updateUser(updated));
    expect(state.items[0].permission_overrides).toEqual(["delete_sale"]);
  });

  it("updates a user's status via updateUser (used by the Deactivate/Reactivate actions)", () => {
    const initial = reducer(
      undefined,
      hydrateUsers([makeProfile({ id: "u1", status: "active" })])
    );
    const deactivated = makeProfile({ id: "u1", status: "deactivated" });
    const state = reducer(initial, updateUser(deactivated));
    expect(state.items[0].status).toBe("deactivated");
  });
});

// ── Client-side pagination slice logic ────────────────────────────────────────
// The page.tsx component slices state.users.items with:
//   users.slice((page - 1) * pageSize, page * pageSize)
// These tests verify the slice math and the pageRangeLabel helper it uses.

function slicePage(items: Profile[], page: number, pageSize: number): Profile[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

describe("users client-side pagination", () => {
  const users = Array.from({ length: 60 }, (_, i) =>
    makeProfile({ id: `user-${i + 1}`, email: `user${i + 1}@example.com` })
  );

  it("page 1 returns first pageSize items", () => {
    const result = slicePage(users, 1, 25);
    expect(result).toHaveLength(25);
    expect(result[0].id).toBe("user-1");
    expect(result[24].id).toBe("user-25");
  });

  it("page 2 returns next pageSize items", () => {
    const result = slicePage(users, 2, 25);
    expect(result).toHaveLength(25);
    expect(result[0].id).toBe("user-26");
    expect(result[24].id).toBe("user-50");
  });

  it("last page returns remaining items when count < pageSize", () => {
    const result = slicePage(users, 3, 25);
    expect(result).toHaveLength(10);
    expect(result[0].id).toBe("user-51");
    expect(result[9].id).toBe("user-60");
  });

  it("empty list returns empty array on any page", () => {
    expect(slicePage([], 1, 25)).toEqual([]);
  });

  it("pageRangeLabel shows correct range on page 1", () => {
    expect(pageRangeLabel(1, 25, 60)).toBe("Showing 1–25 of 60");
  });

  it("pageRangeLabel shows correct range on page 3 (partial)", () => {
    expect(pageRangeLabel(3, 25, 60)).toBe("Showing 51–60 of 60");
  });

  it("pageRangeLabel returns zero label for empty list", () => {
    expect(pageRangeLabel(1, 25, 0)).toBe("Showing 0–0 of 0");
  });
});
