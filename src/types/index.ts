// ─── Core Business Types ─────────────────────────────────────────────────────

export type UserRole = "super_admin" | "admin" | "accountant";

export type UserStatus = "active" | "deactivated";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  // Permission keys (see `Permission` in lib/utils/permissions.ts) granted to
  // this user ADDITIVELY on top of their role's defaults. Kept as `string[]`
  // here (not `Permission[]`) to avoid a circular import — permissions.ts
  // imports `UserRole` from this file.
  permission_overrides: string[];
  // Deactivating a user only revokes dashboard access (gated in src/proxy.ts)
  // — never a hard delete, since created_by FKs on sales/expenses/purchases/
  // etc. would block deleting any profile that's ever created a record.
  status: UserStatus;
  created_at: string;
}

// ─── Financial Records ────────────────────────────────────────────────────────

export type Currency = "EUR" | "USD" | "GBP";

export type ExpenseCategory =
  | "shipping"
  | "advertising"
  | "software"
  | "office"
  | "inventory"
  | "tax"
  | "salary"
  | "other";

export interface Expense {
  id: string;
  title: string;
  amount: number;
  currency: Currency;
  category: ExpenseCategory;
  vendor: string | null;
  date: string; // ISO date
  description: string | null;
  created_by: string; // profile.id
  created_at: string;
  vat_rate: number | null;
  vat_amount: number | null;
  vendor_vat_number: string | null;
  invoice_number: string | null;
}

export interface PlatformPayout {
  id: string;
  platform: "ebay" | "amazon";
  amount: number;
  currency: Currency;
  date: string; // ISO date
  notes: string | null;
  created_by: string;
  created_at: string;
}

export type Platform = "amazon" | "ebay" | "etsy" | "shopify" | "other";

export interface Purchase {
  id: string;
  product_name: string;
  product_id: string | null; // products.id — links to Inventory, optional
  quantity: number;
  unit_price: number;
  total_amount: number;
  currency: Currency;
  vendor: string | null;
  date: string;
  description: string | null;
  created_by: string;
  created_at: string;
  vat_rate: number | null;
  vat_amount: number | null;
  sale_id: string | null; // FK to sales.id — set when purchase is a cost-of-goods for a specific order
}

export interface Sale {
  id: string;
  platform: Platform;
  product_name: string;
  product_id: string | null; // products.id — links to Inventory, optional
  quantity: number;
  unit_price: number;
  total_amount: number;
  currency: Currency;
  date: string;
  description: string | null;
  created_by: string;
  created_at: string;
  vat_rate: number | null;
  vat_amount: number | null;
  shipping_cost: number | null;
  shipping_charged: number | null;
  advertising_fee: number | null;
  status: string; // "pending" | "processing" | "shipped" | "delivered" | "returned" | "cancelled" | custom
  restock: boolean; // only meaningful when status === "returned" — true = item went back to sellable stock
  external_order_id: string | null; // set for orders synced from a platform integration; dedup key with `platform`
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  current_stock: number;
  reorder_threshold: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "login"
  | "logout"
  | "role_change"
  | "permission_change"
  | "status_change";

export type AuditEntity = "expense" | "purchase" | "sale" | "user" | "product";

export interface AuditLog {
  id: string;
  user_id: string;
  user_email: string | null;
  action: AuditAction;
  entity_type: AuditEntity;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export interface DashboardStats {
  totalRevenue: number;
  totalExpenses: number;
  totalPurchases: number;
  netProfit: number;
  currency: Currency;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
}

// ─── Company Profile (per-tenant) ─────────────────────────────────────────────

export interface CompanyProfile {
  id: string;
  name: string;
  logo_url: string | null;
  vat_number: string | null;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  currency: Currency;
  timezone: string;
  vat_rate: number;
  bank_name: string | null;
  iban: string | null;
  bic: string | null;
  invoice_prefix: string;
  payment_terms: string;
  footer_notes: string | null;
  updated_at: string;
}

// ─── SaaS / Multi-Tenant ──────────────────────────────────────────────────────

export type TenantPlan = "trial" | "starter" | "pro" | "business";
export type TenantStatus = "active" | "invited" | "deactivated";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  schema_name: string;
  admin_email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: TenantPlan;
  status: TenantStatus;
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Platform Integrations (per-tenant) ───────────────────────────────────────

export type IntegrationPlatform = "ebay" | "amazon";
export type PlatformConnectionStatus = "connected" | "disconnected" | "error";

/**
 * Client-facing shape of a `platform_connections` row — deliberately omits
 * `access_token`/`refresh_token`/`token_expires_at`, which never leave the
 * server (see `src/lib/integrations/SKILL.md`).
 */
export interface PlatformConnection {
  id: string;
  platform: IntegrationPlatform;
  status: PlatformConnectionStatus;
  external_account_id: string | null;
  marketplace_id: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  updated_at: string;
}

// ─── Dropshipping ─────────────────────────────────────────────────────────────

export type SourcePlatform = "amazon" | "aliexpress";

export interface DropshipListing {
  id: string;
  ebay_listing_id: string;
  title: string;
  image_url: string | null;
  ebay_url: string;
  current_price: number;
  currency: string;
  sku: string | null;
  source_url: string | null;
  source_platform: SourcePlatform | null;
  supplier_price: number | null;
  supplier_currency: string | null;
  supplier_price_checked_at: string | null;
  /** Flat EU customs handling fee for this listing, in supplier_currency. Defaults to 3 (DB column default) — editable per listing. */
  customs_tax_amount: number;
  last_synced_at: string;
  created_at: string;
}

// ─── eBay Listing Drafts ──────────────────────────────────────────────────────

export type ListingSourceType = "inventory" | "dropship";
export type ListingCondition = "new" | "used" | "refurbished";
export type ListingStatus = "draft" | "publishing" | "published" | "failed";

export interface EbayListingDraft {
  id: string;
  source_type: ListingSourceType;
  product_id: string | null;
  source_url: string | null;
  source_platform: SourcePlatform | null;
  title: string;
  description: string | null;
  price: number;
  currency: Currency;
  quantity: number;
  condition: ListingCondition;
  category_id: string | null;
  category_name: string | null;
  image_urls: string[];
  fulfillment_policy_id: string | null;
  payment_policy_id: string | null;
  return_policy_id: string | null;
  ebay_sku: string | null;
  status: ListingStatus;
  ebay_offer_id: string | null;
  ebay_listing_id: string | null;
  publish_error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}
