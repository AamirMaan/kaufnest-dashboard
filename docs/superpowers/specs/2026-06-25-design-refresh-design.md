# Design Refresh — Emerald Light / Violet Dark

**Date:** 2026-06-25  
**Scope:** Global token update + component-level improvements across both themes  
**Goal:** Minimalist aesthetic with vivid, intentional colour use — icons, badges, hover states, and interactive text all feel alive rather than flat grey.

---

## 1. Token Layer (`src/app/globals.css`)

### Light theme — Emerald primary

| Token | Old | New |
|---|---|---|
| `--color-primary` | `#4f46e5` indigo-600 | `#059669` emerald-600 |
| `--color-primary-hover` | `#6366f1` indigo-500 | `#10b981` emerald-500 |
| `--color-primary-muted` | `#eef2ff` indigo-50 | `#ecfdf5` emerald-50 |
| `--color-primary-text` | `#4338ca` indigo-700 | `#047857` emerald-700 |
| `--color-success` | `#059669` emerald-600 | `#16a34a` green-600 |
| `--color-success-bg` | `#ecfdf5` emerald-50 | `#dcfce7` green-50 |
| `--color-success-text` | `#065f46` emerald-800 | `#15803d` green-700 |
| `--chart-1` | `#4f46e5` indigo-600 | `#059669` emerald-600 |

**Why success must change:** the new primary and the old success share the same hex (`#059669`). Shifting success to green-600 keeps them visually distinct while staying in the same family.

### Dark theme additions (inside `[data-theme="dark"]`)

| Token | Old | New |
|---|---|---|
| `--color-primary` | inherits indigo | `#8b5cf6` violet-500 |
| `--color-primary-hover` | inherits | `#a78bfa` violet-400 |
| `--color-primary-muted` | inherits | `#1e1b4b` dark violet |
| `--color-primary-text` | inherits | `#c4b5fd` violet-300 |
| `--color-sidebar-bg` | `#0f172a` slate-900 | `#130f1e` deep violet |
| `--color-sidebar-border` | `#1e293b` slate-800 | `#2d1f47` violet-tinted |
| `--color-sidebar-hover` | `#1e293b` slate-800 | `#2d1f47` violet-tinted |
| `--color-info-bg` | indigo-950 | `#1e1b4b` (matches primary-muted) |
| `--chart-1` | `#4f46e5` indigo-600 | `#8b5cf6` violet-500 |

---

## 2. Component Improvements

### Sidebar (`src/components/layout/Sidebar.tsx`)

- **Active nav item:** pill background at `primary` 15% opacity + icon and label in `primary` colour
- **Inactive icon:** `sidebar-text` (muted), not primary
- **Hover:** text shifts `sidebar-text` → `sidebar-text-strong` + subtle bg tint; `transition: color 150ms ease, background 150ms ease`

### Badge (`src/components/ui/Badge.tsx`)

- Each semantic type gets a vivid fill using the existing semantic tokens:
  - **Success** → `success-bg` / `success-text`
  - **Warning** → `warning-bg` / `warning-text`
  - **Danger** → `danger-bg` / `danger-text`
  - **Default/neutral** → `primary-muted` / `primary-text`
- Font weight: `font-medium` → `font-semibold`

### StatCard (`src/components/ui/StatCard.tsx`)

- **Left border accent:** 3px solid `primary`, `rounded-l` to match card radius
- **Icon colour:** `primary` instead of muted grey
- **Hover:** card shadow deepens + border shifts to full `primary` opacity; `transition: box-shadow 150ms ease, border-color 150ms ease`

### DataTable / table rows (`src/components/ui/DataTable.tsx`)

- **Row hover bg:** `primary-muted` directly (emerald-50 light / dark violet dark) — replaces the current flat grey
- Row text colour unchanged on hover (no inversion)

### Interactive text & links

- Any muted anchor or text-button gets `primary` colour on hover
- `transition: color 120ms ease`
- `text-underline-offset: 2px` on hover

### Buttons

No explicit changes — all primary button colours cascade automatically from the token update.

---

## 3. Files to touch

| File | Change |
|---|---|
| `src/app/globals.css` | Token updates (Sections 1 light + dark) |
| `src/components/ui/Badge.tsx` | Semantic variant colours + font-semibold |
| `src/components/ui/StatCard.tsx` | Left border accent, icon colour, hover shadow |
| `src/components/ui/DataTable.tsx` | Row hover bg |
| `src/components/layout/Sidebar.tsx` | Active pill + icon colour + hover transition |

---

## 4. Out of scope

- Chart colour palettes beyond chart-1
- Page-specific component colours (handled by tokens cascading)
- Dark-mode-specific badge variants (semantic tokens already have dark overrides)
- Stripe / billing UI
