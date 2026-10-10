import { accountsInOrders, filterByAccount } from "./reviewAccounts";
import type { ReviewOrder } from "@/app/api/integrations/review/route";

const o = (id: string, connection_id: string, account_name: string) =>
  ({ external_order_id: id, connection_id, account_name, imported: false }) as ReviewOrder;

describe("accountsInOrders", () => {
  it("lists each account once, in first-seen order", () => {
    expect(accountsInOrders([o("1", "c2", "Two"), o("2", "c1", "One"), o("3", "c2", "Two")])).toEqual([
      { id: "c2", name: "Two" },
      { id: "c1", name: "One" },
    ]);
  });
});

describe("filterByAccount", () => {
  const orders = [o("1", "c1", "One"), o("2", "c2", "Two")];
  it("returns everything for 'all'", () => {
    expect(filterByAccount(orders, "all")).toHaveLength(2);
  });
  it("narrows to one account", () => {
    expect(filterByAccount(orders, "c2").map((x) => x.external_order_id)).toEqual(["2"]);
  });
});
