import { resolveVatAmount, vatInputsUnchanged, type VatFormSnapshot } from "./vatPreservation";

describe("resolveVatAmount", () => {
  // Amazon Vorsteuerkonto row: gross 34.70, stated rate 19%, actual VAT 0.00.
  const importedRateZeroVat: VatFormSnapshot = {
    amount: "34.70",
    vat_rate: "19",
    vat_included: true,
  };

  test("1. unedited save on a rate/amount-disagreeing row keeps the stored VAT", () => {
    const result = resolveVatAmount({
      current: importedRateZeroVat,
      initial: importedRateZeroVat,
      storedVatAmount: 0,
      amount: 34.7,
      vatRate: 19,
    });
    expect(result).toBe(0);
  });

  test("2. changing the amount recomputes VAT from the rate", () => {
    const current: VatFormSnapshot = { ...importedRateZeroVat, amount: "50.00" };
    const result = resolveVatAmount({
      current,
      initial: importedRateZeroVat,
      storedVatAmount: 0,
      amount: 50,
      vatRate: 19,
    });
    expect(result).toBe(7.98); // vatAmountFromGross(50, 19)
  });

  test("3. changing the rate recomputes VAT from the amount", () => {
    const current: VatFormSnapshot = { ...importedRateZeroVat, vat_rate: "7" };
    const result = resolveVatAmount({
      current,
      initial: importedRateZeroVat,
      storedVatAmount: 0,
      amount: 34.7,
      vatRate: 7,
    });
    expect(result).toBe(2.27); // vatAmountFromGross(34.7, 7)
  });

  test("4. unticking 'includes VAT' clears the amount to null regardless of other inputs", () => {
    const current: VatFormSnapshot = { ...importedRateZeroVat, vat_included: false };
    const result = resolveVatAmount({
      current,
      initial: importedRateZeroVat,
      storedVatAmount: 0,
      amount: 34.7,
      vatRate: 19,
    });
    expect(result).toBeNull();
  });

  test("5. unedited save on a row with a VAT amount but no rate keeps the stored VAT", () => {
    // e.vat_rate is null, so expenseToForm seeds vat_rate from the tenant
    // default (here "19") — both current and initial reflect that same seed.
    const noRateSnapshot: VatFormSnapshot = {
      amount: "506.65",
      vat_rate: "19",
      vat_included: true,
    };
    const result = resolveVatAmount({
      current: noRateSnapshot,
      initial: noRateSnapshot,
      storedVatAmount: 96.26,
      amount: 506.65,
      vatRate: 19,
    });
    expect(result).toBe(96.26);
  });

  test("5b. the guard is 'form vs its own initial snapshot', not 'form vs the stored rate' — a naive comparison against a null stored rate would misfire here", () => {
    // If this compared form.vat_rate against the expense's raw vat_rate
    // (null) instead of the form's own initial value, "19" !== null would
    // read as "changed" and silently recompute away the stored 96.26.
    const initial: VatFormSnapshot = { amount: "506.65", vat_rate: "19", vat_included: true };
    const current: VatFormSnapshot = { amount: "506.65", vat_rate: "19", vat_included: true };
    expect(vatInputsUnchanged(current, initial)).toBe(true);
  });
});

describe("vatInputsUnchanged", () => {
  const base: VatFormSnapshot = { amount: "100", vat_rate: "19", vat_included: true };

  test("true when nothing differs", () => {
    expect(vatInputsUnchanged(base, { ...base })).toBe(true);
  });

  test("false when amount differs", () => {
    expect(vatInputsUnchanged({ ...base, amount: "101" }, base)).toBe(false);
  });

  test("false when vat_rate differs", () => {
    expect(vatInputsUnchanged({ ...base, vat_rate: "7" }, base)).toBe(false);
  });

  test("false when vat_included differs", () => {
    expect(vatInputsUnchanged({ ...base, vat_included: false }, base)).toBe(false);
  });
});
