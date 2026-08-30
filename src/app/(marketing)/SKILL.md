---
name: marketing-feature
description: Agent playbook for the public landing page at / (src/app/(marketing)) — pricing changes, adding sections, and why the pricing table derives its feature marks.
---

# Marketing feature playbook

## Minimal file set per change type

- **Change a price**: `src/lib/utils/pricing.ts` → `MONTHLY_EUR`. Nothing else. The
  cards read it.
- **Change what a plan includes**: `src/lib/utils/planGating.ts` →
  `PLAN_LIMITS`. Do **not** hand-edit the ✓/✗ list in `src/lib/utils/pricing.ts` —
  it is derived, and `pricing.test.ts` will fail if the two disagree.
- **Add a feature bullet to the pricing cards**: add it to the `features`
  array in `src/lib/utils/pricing.ts`, sourcing `included` from a `limits.*` field so
  it stays derived. Add a matching assertion in `pricing.test.ts`.
- **Add a page section**: a new component in `_components/`, composed into
  `page.tsx`. Keep it a Server Component unless it genuinely needs state.
- **Change marketing copy**: the relevant `_components/*.tsx` — copy lives
  next to the markup, not in a shared constants file.
- **Add a platform to the `IntegrationsBar`**: only add a real `<img>` logo
  if a licensed SVG asset exists in `public/brand/` — otherwise add it as a
  plain text wordmark rather than recreating the logo yourself. All four
  current entries (eBay/Amazon/Etsy/Shopify) use real assets.

## Gotchas

- **The page renders only for logged-out visitors.** `page.tsx` redirects
  authenticated users to `/dashboard` — except an incompletely-provisioned
  self-serve signup (`user_metadata.company_name` set,
  `app_metadata.tenant_schema` not yet), who goes to `/welcome` instead so
  they aren't stranded (2026-08-29). Don't add signed-in header states;
  they are unreachable either way.
- **This page's accent colour (`emerald-*`/`amber-*`) is deliberately NOT
  the app's `--color-primary` (indigo).** (2026-08-29) Chosen for a bolder,
  more energetic first-look page than the in-app chrome. Don't "fix" this
  back to `--color-primary` — it's intentional. The one exception is the
  "opia" wordmark accent in `MarketingNav.tsx`, which stays indigo since
  it's the same brand mark used everywhere else.
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
