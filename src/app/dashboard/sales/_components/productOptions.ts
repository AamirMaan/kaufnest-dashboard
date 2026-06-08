import type { Product } from "@/types";

/**
 * Sales can only draw down stock that purchases have actually brought in, so
 * the "Inventory Product" dropdown is filtered to in-stock items. `linkedProductId`
 * (the sale's current `product_id` in EditSaleModal) is always kept visible even
 * at 0 stock, so editing an existing sale never silently drops its link.
 */
export function selectableProducts(products: Product[], linkedProductId?: string): Product[] {
  return products.filter((p) => p.current_stock > 0 || p.id === linkedProductId);
}

/** Looks up a product's name for auto-filling `product_name` when the dropdown selection changes. */
export function productNameFor(products: Product[], id: string): string | null {
  return products.find((p) => p.id === id)?.name ?? null;
}
