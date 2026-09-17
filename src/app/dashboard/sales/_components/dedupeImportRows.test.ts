import { dedupeImportRows } from "./dedupeImportRows";
import type { ParsedRow, SaleImportData } from "./importFormats";

function row(
  overrides: Omit<Partial<ParsedRow>, "data"> & { data?: Partial<SaleImportData> | null },
): ParsedRow {
  const { data: dataOverrides, ...rowOverrides } = overrides;
  return {
    rowNum: 1,
    error: null,
    ...rowOverrides,
    data:
      dataOverrides === null
        ? null
        : ({
            platform: "amazon",
            product_name: "Widget",
            quantity: 1,
            unit_price: 10,
            total_amount: 10,
            currency: "EUR",
            date: "2026-05-01",
            description: null,
            vat_rate: null,
            vat_amount: null,
            status: "delivered",
            restock: false,
            external_order_id: "028-6107376-1547566",
            shipping_cost: null,
            shipping_charged: null,
            advertising_fee: null,
            platform_fee: null,
            tracking_number: null,
            shipping_carrier: null,
            ebay_fulfillment_id: null,
            ebay_sync_error: null,
            ebay_synced_at: null,
            original_currency: null,
            original_total_amount: null,
            fx_rate: null,
            fx_rate_date: null,
            buyer_name: null,
            shipping_address_line1: null,
            shipping_address_line2: null,
            shipping_city: null,
            shipping_state: null,
            shipping_postal_code: null,
            shipping_country: null,
            buyer_phone: null,
            buyer_email: null,
            ...dataOverrides,
          } as SaleImportData),
  };
}

describe("dedupeImportRows", () => {
  it("keeps two lines of the same order with different SKUs, composing distinct external_order_id values (the original bug)", () => {
    const rows = [
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1" } }),
      row({ sku: "SKU-B", data: { external_order_id: "ORDER-1" } }),
    ];
    const result = dedupeImportRows(rows);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.data?.external_order_id).sort()).toEqual([
      "ORDER-1:SKU-A",
      "ORDER-1:SKU-B",
    ]);
  });

  it("composes external_order_id even for a single-line order with a sku (no collision)", () => {
    // Always composed when a sku is present, not only on collision — a
    // later refund (possibly in a different file/month) must be able to
    // reconstruct the identical key from its own sku field alone.
    const result = dedupeImportRows([row({ sku: "SKU-A", data: { external_order_id: "ORDER-1" } })]);
    expect(result[0].data?.external_order_id).toBe("ORDER-1:SKU-A");
  });

  it("leaves external_order_id unchanged when the row has no sku", () => {
    const result = dedupeImportRows([row({ sku: null, data: { external_order_id: "ORDER-1" } })]);
    expect(result[0].data?.external_order_id).toBe("ORDER-1");
  });

  it("merges two lines sharing order id AND sku, summing quantity and total_amount", () => {
    const rows = [
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1", quantity: 2, total_amount: 20 } }),
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1", quantity: 3, total_amount: 30 } }),
    ];
    const result = dedupeImportRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0].data?.external_order_id).toBe("ORDER-1:SKU-A");
    expect(result[0].data?.quantity).toBe(5);
    expect(result[0].data?.total_amount).toBe(50);
  });

  it("sums vat_amount when both lines have one, leaves null when neither does", () => {
    const withVat = dedupeImportRows([
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1", vat_amount: 1.5 } }),
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1", vat_amount: 2.5 } }),
    ]);
    expect(withVat[0].data?.vat_amount).toBe(4);

    const withoutVat = dedupeImportRows([
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1", vat_amount: null } }),
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1", vat_amount: null } }),
    ]);
    expect(withoutVat[0].data?.vat_amount).toBeNull();
  });

  it("passes through refund rows and rows with no external_order_id unchanged", () => {
    const refund = row({ isRefund: true, data: null });
    const noOrderId = row({ data: { external_order_id: null as unknown as string } });
    expect(dedupeImportRows([refund])).toEqual([refund]);
    expect(dedupeImportRows([noOrderId])).toEqual([noOrderId]);
  });

  it("keeps different orders (different external_order_id) fully independent", () => {
    const rows = [
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-1" } }),
      row({ sku: "SKU-A", data: { external_order_id: "ORDER-2" } }),
    ];
    const result = dedupeImportRows(rows);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.data?.external_order_id).sort()).toEqual([
      "ORDER-1:SKU-A",
      "ORDER-2:SKU-A",
    ]);
  });

  it("falls back to marking a no-sku collision as a duplicate (cannot disambiguate)", () => {
    const rows = [
      row({ sku: null, data: { external_order_id: "ORDER-1" } }),
      row({ sku: null, data: { external_order_id: "ORDER-1" } }),
    ];
    const result = dedupeImportRows(rows);
    expect(result).toHaveLength(2);
    expect(result[0].skipped).toBeUndefined();
    expect(result[1].skipped).toBe("duplicate in file");
  });
});
