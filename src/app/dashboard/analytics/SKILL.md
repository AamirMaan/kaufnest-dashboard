---
name: dashboard-analytics
description: Work on the /dashboard/analytics detail page — the ranked chart cards, KPI tiles, and Record Transfer admin gate. Use when adding or changing a detail card or its data; for Home's 4-tile summary go to dashboard/SKILL.md instead.
---

# Working on Analytics

This page has no private components or `_lib` of its own — everything it
renders comes from `dashboard/_components/` and `dashboard/_lib/` (the
Overview family). Read `dashboard/CLAUDE.md` for the full file map and
`dashboard/SKILL.md` for the RPC/data-flow gotchas (the trailing-12-month
window, `resolveDateBounds` vs `resolveDateRange`, the Max Rows gotcha,
etc.) — they apply here identically, since this page and Home share the same
`useOverviewData()` hook.

## Adding a detail card

1. Build the card component in `dashboard/_components/<Name>Card.tsx`,
   extending `ChartCard.tsx` + `useChartKit.ts` (see the existing cards —
   `RevenueCard.tsx`, `VatCard.tsx`, etc. — for the pattern). Put any new
   series shaping in `dashboard/_lib/overviewCharts.ts` with a colocated
   test.
2. Add a grid slot for it in this folder's `page.tsx`, inside the
   `grid-cols-1 lg:grid-cols-2` grid.

Don't add it to `dashboard/page.tsx` (Home) unless the design explicitly
wants it promoted there — Home is deliberately capped at 4 KPI tiles + trend
+ donut + recent orders; see `dashboard/SKILL.md`'s "Move a card between Home
and Analytics" entry if you do want to move one.

## Gotcha: the picker isn't shared with Home

`page.tsx` calls its own `useDateRangePicker()` — a separate instance from
`dashboard/page.tsx`'s. Picking "Last Month" on Analytics does not change
what Home shows, and vice versa. This is deliberate (each page's date filter
is independent), not a bug to fix if you notice it.
