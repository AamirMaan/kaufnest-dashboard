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
  /**
   * Bulk "mark all as read" watermark. Notifications created at or before this
   * timestamp are read. Individual dismissals after it live in
   * `notification_reads`. Null = nothing has ever been marked read.
   */
  notifications_read_through: string | null;
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
  platform_fee: number | null; // e.g. eBay/Amazon's own commission — distinct from advertising_fee
  status: string; // "pending" | "processing" | "shipped" | "delivered" | "returned" | "cancelled" | "refunded" | custom
  restock: boolean; // only meaningful when status === "returned" — true = item went back to sellable stock
  /**
   * Total refunded against this order, set by the Amazon REFUND import path.
   * Non-null means a refund has already been deducted from `total_amount` —
   * the importer treats such a sale as a no-op so a re-import cannot deduct
   * twice. Null means no refund has been applied.
   */
  refunded_amount: number | null;
  external_order_id: string | null; // set for orders synced from a platform integration; dedup key with `platform`
  // ─── Buyer shipping address (migration 041) ──────────────────────────────
  // Captured automatically on eBay sync (ebay.ts's fetchOrders), or entered/
  // corrected by hand via AddSaleModal/EditSaleModal's "Shipping Address
  // (optional)" section, on any platform. All nine are user-owned in the
  // re-import merge rule (mergeImportedSale.ts) — a manual correction
  // survives a later re-sync of the same order.
  buyer_name: string | null;
  shipping_address_line1: string | null;
  shipping_address_line2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  /** ISO 3166-1 alpha-2, e.g. "DE". Free text — no format enforcement, matches `referral`'s precedent. */
  shipping_country: string | null;
  buyer_phone: string | null;
  buyer_email: string | null;
  /**
   * Carrier + tracking number captured when an eBay-sourced order's status
   * is set to "shipped" — required by eBay's Fulfillment API. Null for
   * every non-eBay sale, and for an eBay sale not currently "shipped".
   */
  tracking_number: string | null;
  shipping_carrier: string | null;
  /** eBay's fulfillmentId for this order's shipment, once synced. */
  ebay_fulfillment_id: string | null;
  /** Last eBay push-back error, if the most recent attempt failed. Cleared on the next successful sync. */
  ebay_sync_error: string | null;
  ebay_synced_at: string | null;
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

export type AuditEntity = "expense" | "purchase" | "sale" | "user" | "product" | "message";

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

// ─── Notifications ────────────────────────────────────────────────────────

export type NotificationType =
  | "sale.created"
  | "purchase.created"
  | "product.low_stock"
  | "message.received";

export type NotificationCategory = "orders" | "purchases" | "inventory" | "messages";

export interface Notification {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  body: string | null;
  /** Dashboard-relative deep link, e.g. "/dashboard/sales/<id>". */
  link: string | null;
  /** Structured, channel-agnostic data. Email/push templating reads THIS, never title/body. */
  payload: Record<string, unknown> | null;
  /** Who caused the event. Null for externally-caused events (e.g. an inbound buyer message). */
  actor_id: string | null;
  visible_to_roles: UserRole[];
  /** Permission-override key that also grants visibility, e.g. "manage_messages". */
  required_permission: string | null;
  created_at: string;
}

export interface NotificationRead {
  notification_id: string;
  user_id: string;
  read_at: string;
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
  ship_from_street1: string | null;
  ship_from_street2: string | null;
  ship_from_city: string | null;
  ship_from_state: string | null;
  ship_from_postal_code: string | null;
  /** ISO 3166-1 alpha-2, e.g. "DE". Free text — validated at label-purchase time (a later shipping-label feature), not here. */
  ship_from_country: string | null;
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
// "provisioning" is a transient state written by /api/signup/provision before
// it creates the tenant schema, so a crash mid-provision leaves a visible row
// in /admin rather than an invisible half-tenant. It flips to "active" on
// success. Self-serve signups never pass through "invited" — that state
// belongs to the admin invite flow, where the tenant exists before the
// person accepts.
export type TenantStatus = "active" | "invited" | "deactivated" | "provisioning";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  schema_name: string;
  admin_email: string | null;
  /** Free-text attribution: who referred this tenant, for manual payout
   * tracking. Optional, no format enforcement (control-plane migration 009). */
  referral: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: TenantPlan;
  status: TenantStatus;
  /** Platform-admin visibility switch for AI features. The plan grants AI;
   * this revokes it per tenant. Defaults true (control-plane migration 007). */
  ai_enabled: boolean;
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
export type ListingStatus = "draft" | "publishing" | "published" | "failed" | "inactive";

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
  aspects: Record<string, string>;
  origin: "app" | "ebay_import";
  fulfillment_policy_id: string | null;
  payment_policy_id: string | null;
  return_policy_id: string | null;
  merchant_location_key: string | null;
  ebay_sku: string | null;
  status: ListingStatus;
  ebay_offer_id: string | null;
  ebay_listing_id: string | null;
  publish_error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ─── eBay Messages ────────────────────────────────────────────────────────────

export type MessageDirection = "inbound" | "outbound";

export interface EbayMessage {
  id: string;
  external_message_id: string | null;
  item_id: string;
  buyer_username: string;
  direction: MessageDirection;
  subject: string | null;
  body: string;
  question_type: string | null;
  is_read: boolean;
  ebay_created_at: string;
  item_title: string | null;
  item_price: number | null;
  item_currency: string | null;
  item_url: string | null;
  created_at: string;
  updated_at: string;
}
