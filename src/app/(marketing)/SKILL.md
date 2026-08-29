---
name: marketing-feature
description: Agent playbook for the public landing page at / (src/app/(marketing)) — pricing changes, adding sections, and why the pricing table derives its feature marks.
---

# Marketing feature playbook

## Minimal file set per change type

- **Change a price**: `_lib/pricing.ts` → `MONTHLY_EUR`. Nothing else. The
  cards read it.
- **Change what a plan includes**: `src/lib/utils/planGating.ts` →
  `PLAN_LIMITS`. Do **not** hand-edit the ✓/✗ list in `_lib/pricing.ts` —
  it is derived, and `pricing.test.ts` will fail if the two disagree.
- **Add a feature bullet to the pricing cards**: add it to the `features`
  array in `_lib/pricing.ts`, sourcing `included` from a `limits.*` field so
  it stays derived. Add a matching assertion in `pricing.test.ts`.
- **Add a page section**: a new component in `_components/`, composed into
  `page.tsx`. Keep it a Server Component unless it genuinely needs state.
- **Change marketing copy**: the relevant `_components/*.tsx` — copy lives
  next to the markup, not in a shared constants file.

## Gotchas

- **The page renders only for logged-out visitors.** `page.tsx` redirects
  authenticated users to `/dashboard`. Don't add signed-in header states;
  they are unreachable.
- **Never claim a feature the plan matrix gates off.** The ✓/✗ marks are
  derived from `PLAN_LIMITS` precisely so this can't happen by accident, but
  the hero and feature copy are free text — those you have to keep honest
  yourself.
- **Uses the navy icon directly, not `BrandMark`.** `BrandMark` switches on
  `useTheme()`, which would force this Server Component to become a Client
  Component for no benefit — this page has a fixed light background and no
  theme toggle.
- **`/` is in `proxy.ts`'s matcher.** The proxy runs on this route but falls
  through (it only acts on `/login` and `/dashboard/*`). The redirect for
  signed-in users happens in the page, not the proxy.
