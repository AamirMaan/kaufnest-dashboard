import {
  INVENTORY_ERROR_FALLBACK,
  inventoryErrorMessage,
  parseInventoryError,
} from "./inventoryErrors";

describe("parseInventoryError", () => {
  it("parses a trigger-raised message into code and detail", () => {
    expect(parseInventoryError("INV_CONSUMED: 11 of 12 units from this batch are already sold")).toEqual({
      code: "INV_CONSUMED",
      detail: "11 of 12 units from this batch are already sold",
    });
  });

  it("returns null for an unknown INV_ code", () => {
    expect(parseInventoryError("INV_MADE_UP: nope")).toBeNull();
  });

  it("returns null for raw Postgres errors and non-strings", () => {
    expect(parseInventoryError('duplicate key value violates unique constraint "x"')).toBeNull();
    expect(parseInventoryError(undefined)).toBeNull();
    expect(parseInventoryError(42)).toBeNull();
  });
});

describe("inventoryErrorMessage", () => {
  it("returns the trigger detail for a Supabase error object", () => {
    const err = { message: "INV_INSUFFICIENT: Only 3 units are available at the source location", code: "P0001" };
    expect(inventoryErrorMessage(err)).toBe("Only 3 units are available at the source location");
  });

  it("accepts an Error instance and a bare string", () => {
    expect(inventoryErrorMessage(new Error("INV_FORBIDDEN: Only admins can change inventory settings"))).toBe(
      "Only admins can change inventory settings",
    );
    expect(inventoryErrorMessage("INV_NOT_ENABLED: Batches and locations are not enabled for this account")).toBe(
      "Batches and locations are not enabled for this account",
    );
  });

  it("never leaks a raw database message", () => {
    expect(inventoryErrorMessage({ message: 'relation "stock_lots" does not exist' })).toBe(INVENTORY_ERROR_FALLBACK);
    expect(inventoryErrorMessage(null)).toBe(INVENTORY_ERROR_FALLBACK);
  });

  it("uses a caller-supplied fallback", () => {
    expect(inventoryErrorMessage({ message: "boom" }, "Could not save the transfer.")).toBe("Could not save the transfer.");
  });
});
