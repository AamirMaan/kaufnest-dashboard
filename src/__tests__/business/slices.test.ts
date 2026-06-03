import { salesSlice, hydrateSales, addSale, updateSale, removeSale } from "@/store/slices/salesSlice";
import { expensesSlice, hydrateExpenses, addExpense, updateExpense, removeExpense } from "@/store/slices/expensesSlice";
import { purchasesSlice, hydratePurchases, addPurchase, updatePurchase, removePurchase } from "@/store/slices/purchasesSlice";
import { auditLogsSlice, hydrateAuditLogs, addAuditLog } from "@/store/slices/auditLogsSlice";
import { usersSlice, hydrateUsers, addUser, updateUserRole } from "@/store/slices/usersSlice";
import type { Sale, Expense, Purchase, AuditLog, Profile } from "@/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeSale = (overrides: Partial<Sale> = {}): Sale => ({
  id: "sale-1",
  platform: "amazon",
  product_name: "Test Product",
  quantity: 2,
  unit_price: 50,
  total_amount: 100,
  currency: "EUR",
  date: "2026-06-01",
  description: null,
  created_by: "user-1",
  created_at: "2026-06-01T10:00:00.000Z",
  ...overrides,
});

const makeExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: "expense-1",
  title: "Office Supplies",
  amount: 29.99,
  currency: "EUR",
  category: "office",
  vendor: "Staples",
  date: "2026-06-01",
  description: null,
  created_by: "user-1",
  created_at: "2026-06-01T10:00:00.000Z",
  ...overrides,
});

const makePurchase = (overrides: Partial<Purchase> = {}): Purchase => ({
  id: "purchase-1",
  product_name: "Bulk Cable",
  quantity: 10,
  unit_price: 5,
  total_amount: 50,
  currency: "EUR",
  vendor: "Distributor GmbH",
  date: "2026-06-01",
  description: null,
  created_by: "user-1",
  created_at: "2026-06-01T10:00:00.000Z",
  ...overrides,
});

const makeLog = (overrides: Partial<AuditLog> = {}): AuditLog => ({
  id: "log-1",
  user_id: "user-1",
  user_email: "admin@example.com",
  action: "create",
  entity_type: "sale",
  entity_id: "sale-1",
  metadata: null,
  created_at: "2026-06-01T10:00:00.000Z",
  ...overrides,
});

const makeProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: "user-1",
  email: "user@example.com",
  full_name: "Test User",
  role: "accountant",
  created_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

// ─── salesSlice ───────────────────────────────────────────────────────────────

describe("salesSlice", () => {
  const { reducer } = salesSlice;

  it("starts with an empty items array and loaded=false", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it("hydrates items and sets loaded=true", () => {
    const sales = [makeSale(), makeSale({ id: "sale-2" })];
    const state = reducer(undefined, hydrateSales(sales));
    expect(state.items).toHaveLength(2);
    expect(state.loaded).toBe(true);
  });

  it("prepends a new sale via addSale", () => {
    const existing = makeSale({ id: "sale-old" });
    const initial = reducer(undefined, hydrateSales([existing]));
    const newSale = makeSale({ id: "sale-new", product_name: "New Item" });
    const state = reducer(initial, addSale(newSale));
    expect(state.items[0].id).toBe("sale-new");
    expect(state.items).toHaveLength(2);
  });

  it("updates an existing sale in place", () => {
    const sale = makeSale();
    const initial = reducer(undefined, hydrateSales([sale]));
    const updated = makeSale({ product_name: "Updated Product" });
    const state = reducer(initial, updateSale(updated));
    expect(state.items[0].product_name).toBe("Updated Product");
  });

  it("does nothing on updateSale when id not found", () => {
    const initial = reducer(undefined, hydrateSales([makeSale()]));
    const state = reducer(initial, updateSale(makeSale({ id: "missing" })));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("sale-1");
  });

  it("removes a sale by id", () => {
    const sales = [makeSale({ id: "a" }), makeSale({ id: "b" })];
    const initial = reducer(undefined, hydrateSales(sales));
    const state = reducer(initial, removeSale("a"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("b");
  });

  it("does nothing on removeSale when id not found", () => {
    const initial = reducer(undefined, hydrateSales([makeSale()]));
    const state = reducer(initial, removeSale("nonexistent"));
    expect(state.items).toHaveLength(1);
  });
});

// ─── expensesSlice ────────────────────────────────────────────────────────────

describe("expensesSlice", () => {
  const { reducer } = expensesSlice;

  it("starts empty with loaded=false", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it("hydrates expenses", () => {
    const expenses = [makeExpense(), makeExpense({ id: "expense-2" })];
    const state = reducer(undefined, hydrateExpenses(expenses));
    expect(state.items).toHaveLength(2);
    expect(state.loaded).toBe(true);
  });

  it("prepends a new expense via addExpense", () => {
    const initial = reducer(undefined, hydrateExpenses([makeExpense()]));
    const newExpense = makeExpense({ id: "expense-new", title: "New Expense" });
    const state = reducer(initial, addExpense(newExpense));
    expect(state.items[0].id).toBe("expense-new");
    expect(state.items).toHaveLength(2);
  });

  it("updates an existing expense", () => {
    const initial = reducer(undefined, hydrateExpenses([makeExpense()]));
    const updated = makeExpense({ title: "Updated Title" });
    const state = reducer(initial, updateExpense(updated));
    expect(state.items[0].title).toBe("Updated Title");
  });

  it("removes an expense by id", () => {
    const initial = reducer(
      undefined,
      hydrateExpenses([makeExpense({ id: "e1" }), makeExpense({ id: "e2" })])
    );
    const state = reducer(initial, removeExpense("e1"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("e2");
  });
});

// ─── purchasesSlice ───────────────────────────────────────────────────────────

describe("purchasesSlice", () => {
  const { reducer } = purchasesSlice;

  it("starts empty with loaded=false", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it("hydrates purchases", () => {
    const purchases = [makePurchase()];
    const state = reducer(undefined, hydratePurchases(purchases));
    expect(state.items).toHaveLength(1);
    expect(state.loaded).toBe(true);
  });

  it("prepends a new purchase via addPurchase", () => {
    const initial = reducer(undefined, hydratePurchases([makePurchase()]));
    const newPurchase = makePurchase({ id: "purchase-new" });
    const state = reducer(initial, addPurchase(newPurchase));
    expect(state.items[0].id).toBe("purchase-new");
    expect(state.items).toHaveLength(2);
  });

  it("updates an existing purchase", () => {
    const initial = reducer(undefined, hydratePurchases([makePurchase()]));
    const updated = makePurchase({ product_name: "Updated Cable" });
    const state = reducer(initial, updatePurchase(updated));
    expect(state.items[0].product_name).toBe("Updated Cable");
  });

  it("removes a purchase by id", () => {
    const initial = reducer(
      undefined,
      hydratePurchases([makePurchase({ id: "p1" }), makePurchase({ id: "p2" })])
    );
    const state = reducer(initial, removePurchase("p1"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("p2");
  });
});

// ─── auditLogsSlice ───────────────────────────────────────────────────────────

describe("auditLogsSlice", () => {
  const { reducer } = auditLogsSlice;

  it("starts empty with loaded=false", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.items).toEqual([]);
    expect(state.loaded).toBe(false);
  });

  it("hydrates audit logs", () => {
    const logs = [makeLog(), makeLog({ id: "log-2" })];
    const state = reducer(undefined, hydrateAuditLogs(logs));
    expect(state.items).toHaveLength(2);
    expect(state.loaded).toBe(true);
  });

  it("prepends a new log entry via addAuditLog", () => {
    const initial = reducer(undefined, hydrateAuditLogs([makeLog({ id: "old" })]));
    const newLog = makeLog({ id: "new", action: "delete" });
    const state = reducer(initial, addAuditLog(newLog));
    expect(state.items[0].id).toBe("new");
    expect(state.items).toHaveLength(2);
  });

  it("preserves log immutability — existing logs unchanged after prepend", () => {
    const initial = reducer(undefined, hydrateAuditLogs([makeLog({ id: "existing" })]));
    const state = reducer(initial, addAuditLog(makeLog({ id: "new" })));
    expect(state.items[1].id).toBe("existing");
  });

  it("supports all audit action types", () => {
    const actions = ["create", "update", "delete", "login", "logout", "role_change"] as const;
    actions.forEach((action) => {
      const log = makeLog({ id: action, action });
      const state = reducer(undefined, addAuditLog(log));
      expect(state.items[0].action).toBe(action);
    });
  });

  it("supports all entity types", () => {
    const entities = ["expense", "purchase", "sale", "user"] as const;
    entities.forEach((entity_type) => {
      const log = makeLog({ id: entity_type, entity_type });
      const state = reducer(undefined, addAuditLog(log));
      expect(state.items[0].entity_type).toBe(entity_type);
    });
  });
});

// ─── usersSlice ───────────────────────────────────────────────────────────────

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
