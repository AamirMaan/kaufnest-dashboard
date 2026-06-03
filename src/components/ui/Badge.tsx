import type { ExpenseCategory, Platform, UserRole, AuditAction } from "@/types";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-slate-100 text-slate-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  info: "bg-indigo-50 text-indigo-700",
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
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]}`}
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
