# Design Refresh (Emerald Light / Violet Dark) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat indigo palette with an emerald primary (light) / violet primary (dark) theme and improve icon colour, badge vibrancy, stat-card accents, table row hovers, and sidebar active states across both themes.

**Architecture:** All colour changes flow from a single token edit in `globals.css`; component changes are additive (new classes / props) and never touch business logic. Tasks 1–6 are independently deployable in any order except Task 4 which depends on Task 3.

**Tech Stack:** Next.js App Router, Tailwind v4 (canonical `(--var)` CSS-variable syntax), Lucide React icons, CSS custom properties.

## Global Constraints

- All Tailwind CSS-variable utilities MUST use the v4 canonical form: `bg-(--color-surface)` not `bg-[var(--color-surface)]`
- Never add `dark:` Tailwind variants — the project uses `[data-theme="dark"]` on `<html>`; dark overrides live in `globals.css`
- Never start the dev server to verify — ask the user to check in the browser after each task
- Do NOT run `npm test`, `npx tsc --noEmit`, or `npm run lint` mid-task
- These are pure UI/style changes; no unit tests are required

---

### Task 1: Update design tokens (`globals.css`)

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: updated CSS custom properties consumed by every component via Tailwind utilities

- [ ] **Step 1: Replace light-theme primary tokens**

In `:root { … }`, replace the four primary lines and the three success lines:

```css
/* Primary – emerald (was indigo) */
--color-primary:        #059669; /* emerald-600 */
--color-primary-hover:  #10b981; /* emerald-500 */
--color-primary-muted:  #ecfdf5; /* emerald-50  */
--color-primary-text:   #047857; /* emerald-700 */

/* Success – green (shifted off emerald to avoid clash with new primary) */
--color-success:        #16a34a; /* green-600   */
--color-success-bg:     #dcfce7; /* green-50    */
--color-success-text:   #15803d; /* green-700   */
```

- [ ] **Step 2: Update light-theme chart-1**

In `:root { … }`, find `--chart-1` and change to:

```css
--chart-1: #059669; /* emerald-600 */
```

- [ ] **Step 3: Add violet primary + violet sidebar to dark theme**

Inside the existing `[data-theme="dark"] { … }` block, append these lines before the closing `}`:

```css
  /* Primary – violet */
  --color-primary:        #8b5cf6; /* violet-500 */
  --color-primary-hover:  #a78bfa; /* violet-400 */
  --color-primary-muted:  #1e1b4b; /* deep violet muted */
  --color-primary-text:   #c4b5fd; /* violet-300 */

  /* Sidebar – violet-tinted dark */
  --color-sidebar-bg:     #130f1e;
  --color-sidebar-border: #2d1f47;
  --color-sidebar-hover:  #2d1f47;

  /* chart-1 — note: --color-info-bg references --color-primary-muted in :root,
     so it cascades to #1e1b4b automatically; no separate override needed */
  --chart-1:              #8b5cf6; /* violet-500 */
```

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(design): emerald light / violet dark primary tokens"
```

- [ ] **Step 5: Ask user to verify in browser**

Ask the user to reload the dashboard in both light and dark mode. They should see:
- Light: buttons, links, active sidebar item, checkboxes → emerald
- Dark: same elements → violet; sidebar background → deep violet

---

### Task 2: Badge — vivid fill and font weight

**Files:**
- Modify: `src/components/ui/Badge.tsx`

**Interfaces:**
- Consumes: `--color-primary-muted`, `--color-primary-text`, semantic tokens from Task 1
- Produces: updated `Badge` component (same props API, no breaking changes)

- [ ] **Step 1: Update `VARIANT_CLASSES` and base className**

Replace the entire file content with:

```tsx
import type { ExpenseCategory, Platform, UserRole, AuditAction } from "@/types";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-(--color-primary-muted) text-(--color-primary-text)",
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
```

Changes from current:
- `default` variant: `surface-subtle/text-base` → `primary-muted/primary-text`
- `font-medium` → `font-semibold`
- All `[var(--...)]` → `(--...)` Tailwind v4 syntax

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/Badge.tsx
git commit -m "feat(design): vivid badge fills + font-semibold"
```

- [ ] **Step 3: Ask user to verify in browser**

Check any page with badges (e.g. Orders, Audit Logs). Default badges should now appear in emerald/violet tint, not grey. Success/warning/danger badges should be more saturated.

---

### Task 3: StatCard — left border accent, icon prop, hover lift

**Files:**
- Modify: `src/components/ui/StatCard.tsx`

**Interfaces:**
- Produces: `StatCard({ label, value, subtext?, trend?, icon? })` — adds optional `icon?: React.ReactNode`

- [ ] **Step 1: Replace StatCard implementation**

```tsx
interface StatCardProps {
  label: string;
  value: string;
  subtext?: string;
  trend?: "up" | "down" | "neutral";
  icon?: React.ReactNode;
}

export function StatCard({ label, value, subtext, trend, icon }: StatCardProps) {
  const trendColor =
    trend === "up"
      ? "text-(--color-success)"
      : trend === "down"
      ? "text-(--color-danger)"
      : "text-(--color-text-muted)";

  return (
    <div
      className="bg-(--color-surface) rounded-(--radius-card) border border-(--color-border) border-l-4 border-l-(--color-primary) p-5 transition-[box-shadow,border-color] duration-150 hover:shadow-lg"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-(--color-text-muted)">{label}</p>
        {icon && (
          <span className="text-(--color-primary)">{icon}</span>
        )}
      </div>
      <p className="mt-1 text-2xl font-bold text-(--color-text-strong) tabular-nums">{value}</p>
      {subtext && (
        <p className={`mt-1 text-xs font-medium ${trendColor}`}>{subtext}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/StatCard.tsx
git commit -m "feat(design): StatCard left border accent, icon prop, hover lift"
```

- [ ] **Step 3: Ask user to verify in browser**

The Overview page stat cards should now have a green left border accent (light) or violet (dark) and lift slightly on hover. Icons will appear once Task 4 is done.

---

### Task 4: Dashboard page — add icons to StatCards

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `StatCard` icon prop from Task 3
- Consumes: Lucide icons (already a dependency via sidebar)

- [ ] **Step 0: Read the file**

Read `src/app/dashboard/page.tsx` in full before editing — you need to see the exact StatCard JSX and existing imports.

- [ ] **Step 1: Add icon imports**

At the top of `src/app/dashboard/page.tsx`, add these imports alongside the existing ones:

```tsx
import { DollarSign, TrendingDown, ShoppingCart, BarChart3, Package } from "lucide-react";
```

- [ ] **Step 2: Add icon prop to each StatCard call**

Find the 5 `<StatCard … />` usages and add the `icon` prop to each. Match each icon to its label:

| Label | Icon |
|---|---|
| Revenue / total revenue | `<DollarSign size={18} />` |
| Expenses | `<TrendingDown size={18} />` |
| Purchases | `<ShoppingCart size={18} />` |
| Net Profit | `<BarChart3 size={18} />` |
| Orders | `<Package size={18} />` |

Example — adapt to the actual JSX you see in the file:

```tsx
<StatCard
  label="Revenue"
  value={formatCurrency(revenue, currency)}
  subtext={…}
  trend="up"
  icon={<DollarSign size={18} />}
/>
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(design): add icons to Overview StatCards"
```

- [ ] **Step 4: Ask user to verify in browser**

The 5 stat cards on `/dashboard` should each show a small icon in the top-right corner in the primary colour.

---

### Task 5: DataTable — primary-muted row hover

**Files:**
- Modify: `src/components/ui/DataTable.tsx`

**Interfaces:**
- Produces: same `DataTable<T>` API, no prop changes

- [ ] **Step 1: Update row hover and convert Tailwind v4 syntax**

Find the `<tr>` element in the `sortedRows.map` block (line ~140). Change its className:

```tsx
// Before
className={`hover:bg-[var(--color-surface-subtle)] transition-colors ${isSelected ? "bg-[var(--color-info-bg)]" : ""}`}

// After
className={`hover:bg-(--color-primary-muted) transition-colors duration-150 ${isSelected ? "bg-(--color-info-bg)" : ""}`}
```

Also update all other `[var(--...)]` occurrences in the file to `(--...)` syntax:

```tsx
// Outer wrapper div (line ~82)
className="rounded-(--radius-card) border border-(--color-border) overflow-hidden"

// table (line ~86)
className="min-w-full divide-y divide-(--color-border)"

// thead (line ~87)
className="bg-(--color-surface-subtle)"

// th sort button hover (line ~111)
className="inline-flex items-center gap-1 cursor-pointer hover:text-(--color-text-strong) transition-colors"

// sort icon (line ~115)
className={isSorted ? "text-(--color-primary)" : "text-(--color-text-faint)"}

// th text (line ~105)
className={`px-4 py-3 text-left text-xs font-semibold text-(--color-text-muted) uppercase tracking-wider ${col.className ?? ""}`}

// tbody (line ~125)
className="divide-y divide-(--color-border-subtle) bg-(--color-surface)"

// empty td (line ~131)
className="px-4 py-10 text-center text-sm text-(--color-text-faint)"

// checkbox accent (line ~95 and ~150)
className="cursor-pointer accent-(--color-primary)"
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/DataTable.tsx
git commit -m "feat(design): primary-muted row hover + Tailwind v4 syntax"
```

- [ ] **Step 3: Ask user to verify in browser**

On any page with a table (Orders, Expenses, etc.), hover over rows — they should now show a soft emerald (light) or violet (dark) tint instead of flat grey.

---

### Task 6: Sidebar — active pill + icon colour + hover transition

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Produces: same `Sidebar` props API, visual changes only

- [ ] **Step 1: Update active and hover nav link classes**

Find the `className` array inside `visibleItems.map(...)` (around line 181). Replace the `isActive` ternary:

```tsx
// Before
isActive
  ? "bg-[var(--color-sidebar-active)] text-white"
  : "text-[var(--color-sidebar-text)] hover:text-[var(--color-sidebar-text-strong)] hover:bg-[var(--color-sidebar-hover)]",

// After
isActive
  ? "bg-(--color-primary)/15 text-(--color-primary)"
  : "text-(--color-sidebar-text) hover:text-(--color-sidebar-text-strong) hover:bg-(--color-sidebar-hover)",
```

Apply the same change to the `showAdminLink` block (around line 200):

```tsx
// Before
pathname.startsWith("/admin")
  ? "bg-[var(--color-sidebar-active)] text-white"
  : "text-[var(--color-sidebar-text)] hover:text-[var(--color-sidebar-text-strong)] hover:bg-[var(--color-sidebar-hover)]",

// After
pathname.startsWith("/admin")
  ? "bg-(--color-primary)/15 text-(--color-primary)"
  : "text-(--color-sidebar-text) hover:text-(--color-sidebar-text-strong) hover:bg-(--color-sidebar-hover)",
```

- [ ] **Step 2: Convert remaining `[var(--...)]` to `(--...)` and add transition timing**

Update the `transition-colors` on all nav links to `transition-colors duration-150` (both `visibleItems` link and admin link).

Also update the other sidebar class occurrences:

```tsx
// aside element classes (line ~134)
"bg-(--color-sidebar-bg) border-r border-(--color-sidebar-border)"

// collapse toggle button (line ~145)
"... bg-(--color-sidebar-bg) border border-(--color-sidebar-border) text-(--color-sidebar-text) hover:text-(--color-sidebar-text-strong) hover:border-(--color-primary) ..."

// mobile header border (line ~151)
"... border-b border-(--color-sidebar-border) ..."

// brand name (line ~154)
"text-(--color-sidebar-text-strong)"
// KaufNest accent span
"text-(--color-primary-hover)"

// brand subtitle (line ~156)
"text-(--color-sidebar-text)"

// mobile close button (line ~160)
"text-(--color-sidebar-text) hover:text-(--color-sidebar-text-strong) hover:bg-(--color-sidebar-hover)"

// nav link base class (line ~182)
"... rounded-(--radius-btn) ..."

// admin link border-t (line ~203)
"border-t border-(--color-sidebar-border)"
```

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat(design): sidebar active pill + primary icon colour + Tailwind v4 syntax"
```

- [ ] **Step 4: Ask user to verify in browser**

The active nav item should now show a semi-transparent emerald (light) / violet (dark) pill background with the icon and label in the primary colour — no longer a solid white-text block. Inactive items should smoothly transition text colour on hover.
