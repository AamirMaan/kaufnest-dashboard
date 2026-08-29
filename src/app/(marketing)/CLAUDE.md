# Marketing feature

Route: `/` — the public landing page. A route group (`(marketing)`) rather
than a bare `src/app/page.tsx` so the page, its sections and its pricing
logic sit together, mirroring how `(auth)` is organised.

Renders **only for logged-out visitors**: `page.tsx` redirects an
authenticated user to `/dashboard` — preserving what the old
`src/app/page.tsx` redirect did — unless they're a self-serve signup whose
provisioning never finished (`user_metadata.company_name` set,
`app_metadata.tenant_schema` not yet), in which case it sends them to
`/welcome` instead so they aren't stranded (2026-08-29, same check
`auth/confirm/route.ts` uses). That is why no component here has a
signed-in state.

## Files in this folder

- `layout.tsx` — full-height page background. No app chrome (no sidebar,
  no `DashboardShell`).
- `page.tsx` — Server Component. Auth redirect, then composes the sections.
- `_components/MarketingNav.tsx` — logo + "Sign in" + "Start free trial".
- `_components/Hero.tsx` — headline, CTA, the "14 days free · no credit
  card" line.
- `_components/Features.tsx` — six feature cards from a local `FEATURES`
  array. **Only describe things that actually ship.**
- `_components/Pricing.tsx` — three plan cards, rendered from
  `_lib/pricing.ts`. Anchored at `#pricing` (the hero's secondary CTA links
  to it).
- `_components/TrialInfo.tsx` — what the trial includes and what happens
  when it ends.
- `_components/MarketingFooter.tsx` — copyright, privacy, sign in.
- `_lib/pricing.ts` (+ colocated test) — prices and plan copy. See below.

## Pricing is derived, not transcribed

`_lib/pricing.ts` declares the € amounts, but every ✓/✗ in the table is
computed from `PLAN_LIMITS` (`lib/utils/planGating.ts`). The page therefore
**cannot advertise a feature the application gates off** — change the plan
matrix and the page follows. `pricing.test.ts` pins the two together.

**To change a price:** edit `MONTHLY_EUR` in `_lib/pricing.ts`, nothing else.
**To change what a plan includes:** edit `PLAN_LIMITS`, not this folder.

## Shared dependencies

- `public/brand/boughtopia-icon-bag.svg` — the navy icon, used directly
  rather than via `BrandMark`, because this page has a fixed light
  background and no theme toggle.
- `lib/supabase/server` (`createClient`) — the logged-in redirect.
- `lib/utils/planGating` (`getPlanLimits`) — via `_lib/pricing.ts`.
- `lucide-react` — `Check`/`X` for the pricing table.

## Tests

`npx jest marketing` runs `_lib/pricing.test.ts`.
