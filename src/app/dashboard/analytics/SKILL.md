---
name: dashboard-analytics
description: Work on the /dashboard/analytics charts page — trend chart, platform donut and the detail chart cards. Use when adding or changing a chart; for Home's stat tiles and per-platform numbers go to dashboard/SKILL.md instead.
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

Don't add it to `dashboard/page.tsx` (Home) — Home is numbers only (KPI
tiles, per-platform stat cards, recent orders); charts belong here. Likewise
don't add KPI tiles here. See `dashboard/SKILL.md`'s "Rule of the split".

## Gotcha: the picker isn't shared with Home

`page.tsx` calls its own `useDateRangePicker()` — a separate instance from
`dashboard/page.tsx`'s. Picking "Last Month" on Analytics does not change
what Home shows, and vice versa. This is deliberate (each page's date filter
is independent), not a bug to fix if you notice it.
