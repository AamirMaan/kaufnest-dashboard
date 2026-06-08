// ─── Core Business Types ─────────────────────────────────────────────────────

export type UserRole = "super_admin" | "admin" | "accountant";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
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
  | "role_change";

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
