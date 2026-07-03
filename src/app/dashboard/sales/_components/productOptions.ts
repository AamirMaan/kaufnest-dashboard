/**
 * Minimal product shape used by Sales modal dropdowns. This accepts both the
 * full `Product` type and the lightweight `ProductSelector` (id/name/current_stock/sku)
 * — Sales modals source from `state.inventory.selectorItems` which uses the
 * lighter shape so the dropdown is never page-limited.
 */
export interface SelectorProduct {
  id: string;
  name: string;
  current_stock: number;
  sku?: string | null;
}

/**
 * Sales can only draw down stock that purchases have actually brought in, so
 * the "Inventory Product" dropdown is filtered to in-stock items. `linkedProductId`
 * (the sale's current `product_id` in EditSaleModal) is always kept visible even
 * at 0 stock, so editing an existing sale never silently drops its link.
 */
export function selectableProducts(products: SelectorProduct[], linkedProductId?: string): SelectorProduct[] {
  return products.filter((p) => p.current_stock > 0 || p.id === linkedProductId);
}

/** Looks up a product's name for auto-filling `product_name` when the dropdown selection changes. */
export function productNameFor(products: SelectorProduct[], id: string): string | null {
  return products.find((p) => p.id === id)?.name ?? null;
}
