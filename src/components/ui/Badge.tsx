import type { ExpenseCategory, Platform, UserRole, AuditAction } from "@/types";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-(--color-badge-default-bg) text-(--color-badge-default-text)",
  success: "bg-(--color-success-bg) text-(--color-success-text)",
  warning: "bg-(--color-warning-bg) text-(--color-warning-text)",
  danger:  "bg-(--color-danger-bg) text-(--color-danger-text)",
  info:    "bg-(--color-info-bg) text-(--color-info-text)",
};

const ROLE_VARIANTS: Record<UserRole, BadgeVariant> = {
  super_admin: "danger",
  admin: "warning",
  accountant: "info",
};

const ACTION_VARIANTS: Record<AuditAction, BadgeVariant> = {
  create: "success",
  update: "info",
  delete: "danger",
  login: "default",
  logout: "default",
  role_change: "warning",
};

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

export function Badge({ label, variant = "default" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-(--radius-badge) px-2.5 py-0.5 text-xs font-semibold ${VARIANT_CLASSES[variant]}`}
    >
      {label}
    </span>
  );
}

export function RoleBadge({ role }: { role: UserRole }) {
  return <Badge label={role.replace("_", " ")} variant={ROLE_VARIANTS[role]} />;
}

export function ActionBadge({ action }: { action: AuditAction }) {
  return <Badge label={action.replace("_", " ")} variant={ACTION_VARIANTS[action]} />;
}

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  shipping: "Shipping",
  advertising: "Advertising",
  software: "Software",
  office: "Office",
  inventory: "Inventory",
  tax: "Tax",
  salary: "Salary",
  other: "Other",
};

export function CategoryBadge({ category }: { category: ExpenseCategory }) {
  return <Badge label={CATEGORY_LABELS[category]} variant="default" />;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  amazon: "Amazon",
  ebay: "eBay",
  etsy: "Etsy",
  shopify: "Shopify",
  other: "Other",
};

const PLATFORM_VARIANTS: Record<Platform, BadgeVariant> = {
  amazon: "warning",
  ebay: "danger",
  etsy: "success",
  shopify: "info",
  other: "default",
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <Badge
      label={PLATFORM_LABELS[platform]}
      variant={PLATFORM_VARIANTS[platform]}
    />
  );
}

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  pending: "default",
  processing: "info",
  shipped: "info",
  delivered: "success",
  returned: "danger",
  cancelled: "warning",
};

export function StatusBadge({ status }: { status: string }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <Badge label={label} variant={STATUS_VARIANTS[status] ?? "default"} />;
}
