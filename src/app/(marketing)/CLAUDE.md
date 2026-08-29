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
  no `DashboardShell`). Uses a literal `bg-white`, not a `--color-*` token
  (2026-08-29) — `--color-bg` is undefined project-wide (a pre-existing
  quirk shared with `/account-deactivated`/`/account-suspended`), so it was
  silently inert here: sections with no background of their own (nav,
  footer, pricing) were falling through to `<body>`'s dark-mode-default
  background. A literal white background on this wrapper guarantees no dark
  bleed-through regardless of the app-wide theme, on top of the
  `data-theme="light"` already forcing every *token-driven* section
  (Features, TrialInfo) light.
- `page.tsx` — Server Component. Auth redirect, then composes the sections.
- `_components/MarketingNav.tsx` — logo + "Sign in" + "Start free trial".
- `_components/Hero.tsx` — headline, CTA, the "14 days free · no credit
  card" pill, two `animate-pulse` blurred gradient blobs behind the text
  (pure CSS, no client component needed), and a framed product screenshot
  (`public/brand/Boughtopia-dashboard.png`) below the CTAs.
- `_components/IntegrationsBar.tsx` (2026-08-29) — "Sync with the platforms
  you already sell on" trust bar, right under the hero. Real logo assets for
  all four: `public/brand/e-bay-logo.svg`, `amazon-logo.svg`, `etsy.svg`,
  `shopify-logo2.svg`. All four render grayscale/muted at rest and reveal
  full colour on hover, for a consistent row.
- `_components/Features.tsx` — six feature cards from a local `FEATURES`
  array, each with a `lucide-react` icon in an emerald badge. **Only
  describe things that actually ship.**
- `_components/Pricing.tsx` — three plan cards, rendered from
  `src/lib/utils/pricing.ts`. Anchored at `#pricing` (the hero's secondary CTA links
  to it). The emerald border/shadow "lift" is a pure-CSS `hover:` state on
  every card equally (not tied to `plan.highlighted`) — only the "Most
  popular" badge and the CTA button's solid-vs-outline styling are still
  keyed off `plan.highlighted`. Don't restore a permanent highlighted
  border on Pro; that was the thing this was changed away from.
- `_components/TrialInfo.tsx` — what the trial includes and what happens
  when it ends.
- `_components/MarketingFooter.tsx` — copyright, privacy, sign in.

## Pricing is derived, not transcribed

`src/lib/utils/pricing.ts` declares the € amounts, but every ✓/✗ in the table is
computed from `PLAN_LIMITS` (`lib/utils/planGating.ts`). The page therefore
**cannot advertise a feature the application gates off** — change the plan
matrix and the page follows. `pricing.test.ts` pins the two together.

**To change a price:** edit `MONTHLY_EUR` in `src/lib/utils/pricing.ts`, nothing else.
**To change what a plan includes:** edit `PLAN_LIMITS`, not this folder.

## Accent colour is page-scoped, not the app's `--color-primary` (2026-08-29)

The rest of the app (dashboard, emails, `BrandMark`) uses the indigo
`--color-primary` token. This page deliberately uses plain Tailwind
`emerald-*`/`amber-*` classes for its CTAs, feature icons, and the
"Most popular" badge instead — a bolder, more energetic palette than the
app chrome, chosen because a first-look marketing page and an in-app tool
don't need to look identical. **This is intentional, not a drift bug** —
don't "fix" it back to `--color-primary`. The logotype's "opia" accent in
`MarketingNav.tsx` is the one exception: it stays indigo, since it's the
same brand mark shown everywhere else (login, emails, dashboard header).

## Shared dependencies

- `public/brand/boughtopia-icon-bag.svg` — the navy icon, used directly
  rather than via `BrandMark`, because this page has a fixed light
  background and no theme toggle.
- `public/brand/e-bay-logo.svg`, `amazon-logo.svg`, `etsy.svg`,
  `shopify-logo2.svg` — real logo assets, used by `IntegrationsBar.tsx` only.
- `public/brand/Boughtopia-dashboard.png` — the hero's product screenshot.
- `lib/supabase/server` (`createClient`) — the logged-in redirect.
- `lib/utils/planGating` (`getPlanLimits`) — via `lib/utils/pricing.ts`.
- `lucide-react` — `ArrowRight` (Hero), `Layers`/`RefreshCw`/`Receipt`/
  `Package`/`MessageSquare`/`Users` (Features), `Check`/`X` (Pricing).

## Tests

Pricing's derivation logic is tested at `src/lib/utils/pricing.test.ts`
(moved out of this folder 2026-08-29 once Settings and `/trial-expired`
became consumers too — run `npx jest lib/utils/pricing`). This folder no
longer has a `_lib/` of its own.
