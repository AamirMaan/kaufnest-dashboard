---
name: feedback-shadcn-ui
description: User wants shadcn/ui used for all new components going forward; existing custom components stay as-is
metadata:
  type: feedback
---

Use shadcn/ui for all new UI components going forward.

**Why:** User decided shadcn/ui is easier to use, maintain, and requires less work than the existing hand-rolled component system.

**How to apply:**
- New features: use shadcn components (`npx shadcn@latest add <component>`)
- Existing features: leave their custom components untouched (`Button.tsx`, `Modal.tsx`, `DataTable.tsx`, etc.) — do not migrate unless asked
- The project uses Tailwind v4 + shadcn; `components.json` is at the root
- shadcn tokens (`--primary`, `--background`, `--border`, etc.) are mapped to the existing `--color-*` brand tokens in `globals.css`, so shadcn components automatically inherit the indigo brand and dark/light themes
- Dark mode uses `[data-theme="dark"]` on `<html>` (set by `ThemeProvider`) — NOT a `.dark` class. Any shadcn component that uses `dark:` Tailwind variants will NOT respond to the project's theme toggle without a custom variant (`@custom-variant dark (&:is(.dark *))` is defined but not activated). Prefer using the mapped CSS variables instead of `dark:` variants in new components.
- **Button naming conflict**: macOS is case-insensitive, so `Button.tsx` and `button.tsx` are the same file. The custom `Button.tsx` (with `variant="primary"/"secondary"/"danger"/"ghost"`) is kept intact. If a shadcn Button is needed, import from the cva-based file or use inline className with `buttonVariants` — do not run `npx shadcn add button` as it will overwrite the existing Button.tsx.
- `src/lib/utils.ts` now exports `cn()` (clsx + tailwind-merge) — use it in all new shadcn-based components
