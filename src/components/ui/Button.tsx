import { type ButtonHTMLAttributes, forwardRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "invoice" | "export" | "import";
export type ButtonSize = "sm" | "md" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-(--color-primary) hover:bg-(--color-primary-hover) text-white",
  secondary:
    "bg-(--color-surface) hover:bg-(--color-surface-subtle) text-(--color-text-base) border border-(--color-border)",
  danger:
    "bg-(--color-danger-bg) hover:brightness-95 text-(--color-danger-text) border border-(--color-border)",
  ghost:
    "text-(--color-text-muted) hover:text-(--color-text-base) hover:bg-(--color-surface-subtle)",
  invoice:
    "bg-(--color-info-bg) text-(--color-info-text) border border-(--color-border) hover:brightness-95",
  export:
    "bg-(--color-badge-default-bg) text-(--color-badge-default-text) border border-(--color-border) hover:brightness-95",
  import:
    "bg-(--color-success-bg) text-(--color-success-text) border border-(--color-border) hover:brightness-95",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm:   "px-3 py-1.5 text-xs",
  md:   "px-4 py-2 text-sm",
  icon: "p-1.5 text-xs",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center gap-1.5 rounded-(--radius-btn) font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
