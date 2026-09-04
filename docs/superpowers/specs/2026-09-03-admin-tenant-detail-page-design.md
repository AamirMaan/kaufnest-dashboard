# Admin tenant management: detail page + icon/confirm cleanup

Date: 2026-09-03
Status: approved
Feature folder: `src/app/admin/`

## Problem

The `/admin` "Tenant Management" table (`src/app/admin/page.tsx`) is
overloaded: 8 columns (Tenant, Admin Email, Plan, Status, AI Usage, Trial
Ends, Created, Actions) with a 5-button action row crammed into the last
cell. Buttons are plain text (`Edit`, `AI: On`, `Resend Invite`,
`Impersonate`, `Delete`) with no icons, and only Delete has a proper
confirmation modal — Impersonate uses a browser `window.confirm()`, and
Toggle AI fires immediately with no confirmation at all.

## Goals

1. Slim the table to: Tenant, Admin Email, Plan, Status, AI Usage, and a
   final column containing a single hamburger-icon link to a new per-tenant
   detail page.
2. Move Trial Ends, Created, and all mutating actions off the table and
   onto the detail page.
3. Give every action button a matching icon and a semantic color.
4. Add proper (non-native) confirmation modals for Impersonate and Toggle
   AI. Delete keeps its existing type-to-confirm modal. Resend Invite stays
   a direct-fire action (unchanged) — the user explicitly scoped
   confirmations to Delete/Impersonate/Toggle AI only.

## Non-goals

- No new API routes. The detail page reuses the existing
  `GET /api/admin/tenants` (list) and `GET /api/admin/ai-usage` responses,
  filtering client-side by the route's `[id]` param — same approach the
  list page already uses, and tenant counts are small enough that a bulk
  fetch is fine.
- No change to any route handler under `src/app/api/admin/*` — this is a
  presentation-layer reorganization only.
- No new `Button` variants. Semantic color comes from tinting icons with
  existing theme tokens (`--color-success-text`, `--color-warning-text`,
  `--color-info-text`, `--color-text-faint`), not from new button
  background colors.

## Architecture

### Route

`src/app/admin/tenants/[id]/page.tsx` — new client component page.

- On mount, runs the same two fetches `page.tsx` already does
  (`/api/admin/tenants`, `/api/admin/ai-usage`), finds the tenant by
  `useParams<{ id: string }>().id`.
- States: loading (skeleton text, matches list page's `"Loading…"`
  convention), not-found (tenant id not in the list — message + back link),
  loaded.
- A `refreshKey` state, bumped after any mutation from
  `TenantDetailActions`, re-runs both fetches (mirrors `page.tsx`'s existing
  pattern) — no full page reload needed.

### Table changes (`page.tsx`)

- Table header row becomes: `["Tenant", "Admin Email", "Plan", "Status",
  "AI Usage", ""]` (last header cell is empty — the hamburger column needs
  no label, consistent with icon-only action columns elsewhere in the app).
- Remove the `Trial Ends` and `Created` `<td>`s.
- Replace the `<TenantActions .../>` cell with a single `Link` styled like
  a ghost icon button:
  ```tsx
  <Link
    href={`/admin/tenants/${t.id}`}
    aria-label={`View ${t.name} details`}
    className="inline-flex items-center justify-center rounded-(--radius-btn) p-1.5 text-(--color-text-muted) hover:text-(--color-text-base) hover:bg-(--color-surface-subtle) transition-colors"
  >
    <Menu size={16} />
  </Link>
  ```
  (Copies `Button`'s ghost-variant classes directly rather than extending
  `Button` to accept `as="a"` — `Button` stays a plain `<button>`, matching
  its current contract.)
- The AI Usage cell's existing click-to-open-`AiUsageModal` behavior is
  unchanged.
- `TenantActions` import/usage is removed from `page.tsx` entirely.

### `AiUsageModal.tsx` → split out `AiUsageBreakdown.tsx`

- New `src/app/admin/_components/AiUsageBreakdown.tsx`: presentational,
  takes `{ used, limit, byUser }`, renders the "`{used} of {limit}
  generations this month`" line + the sorted-by-calls breakdown table (or
  "No AI usage this month."). No `Modal` wrapper, no `tenant`/`onClose`.
- `AiUsageModal.tsx` becomes a thin wrapper: `Modal` + `AiUsageBreakdown`,
  keeping its existing `{ open, tenant, used, limit, byUser, onClose }`
  props so the table's existing call site is untouched.
- The detail page renders `AiUsageBreakdown` directly inside a card, no
  modal.

### `TenantActions.tsx` → `TenantDetailActions.tsx`

Retire `TenantActions.tsx`; its logic moves to a new
`src/app/admin/_components/TenantDetailActions.tsx`, rendered only from the
detail page. Same `{ tenant, onRefresh }` props and same underlying fetches
(`/api/admin/tenants/[id]` PATCH, `/api/admin/resend-invite`,
`/api/admin/impersonate`), restyled per the table below, with two new
confirmation modals.

| Action | Icon | Button | Icon tint | Confirmation |
|---|---|---|---|---|
| Edit | `Pencil` | `variant="secondary"` | default (inherits button text color) | none — opens `EditTenantModal` (existing), Save Changes is the commit point |
| Toggle AI | `Sparkles` | `variant="secondary"` | `text-(--color-success-text)` when `tenant.ai_enabled` is true, `text-(--color-text-faint)` when false | **new** `ConfirmActionModal` |
| Resend Invite | `Mail` | `variant="secondary"`, only rendered when `tenant.status === "invited"` | `text-(--color-info-text)` | none (unchanged behavior) |
| Impersonate | `UserCog` | `variant="secondary"` | `text-(--color-warning-text)` | **new** `ConfirmActionModal`, replacing `window.confirm(...)` |
| Delete | `Trash2` | `variant="danger"` | inherits danger button's text color | existing `DeleteTenantModal`, unchanged |

Busy states keep the existing label-swap convention (`"Saving…"`,
`"Sending…"`, `"Loading…"`, `"Deleting…"`) alongside `disabled`.

### New `ConfirmActionModal.tsx`

`src/app/admin/_components/ConfirmActionModal.tsx` — a generic yes/no
confirmation dialog, distinct from the shared `DeleteConfirmModal`
(`src/components/modals/`) which forces a typed reason and is scoped to
delete-style flows elsewhere in the app. Impersonate and Toggle AI don't
need a reason, just a confirm.

Props:
```ts
interface Props {
  open: boolean;
  title: string;
  message: string;             // plain sentence, e.g. "Impersonate jane@acme.com for tenant Acme?"
  confirmLabel: string;        // e.g. "Impersonate", "Hide AI", "Enable AI"
  confirmingLabel: string;     // e.g. "Loading…", "Saving…"
  tone: "warning" | "success" | "info";
  loading: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}
```
Renders via the shared `Modal`, a tinted banner (same visual pattern as
`DeleteTenantModal`'s danger banner, but colored by `tone` using the
existing `--color-{warning,success,info}-{bg,text}` tokens), Cancel + a
confirm button. The confirm button is always `variant="primary"` regardless
of `tone` — same convention as `EditTenantModal`'s "Save Changes" — the
`tone` only colors the informational banner, not the button; no new
`Button` variant is added. `loading` disables both buttons, matching
`DeleteTenantModal`'s `disabled={deleting}` pattern.

`TenantDetailActions` owns two instances of this: one for Toggle AI, one
for Impersonate, each with their own open/loading state, following the
existing per-action state pattern already in `TenantActions.tsx`
(`resending`, `togglingAi`, `loading`, `deleteOpen`).

### Detail page content

```
← Back to Tenant Management

Acme GmbH                                    [pro] [active]
tenant_acme

┌─ Details ──────────────────────────┐
│ Admin Email   admin@acme.com       │
│ Trial Ends    —                    │
│ Created       03.09.2026           │
└─────────────────────────────────────┘

┌─ AI Usage ──────────────────────────┐
│ 12 of 50 generations this month     │
│ [byUser breakdown table]            │
└─────────────────────────────────────┘

┌─ Actions ────────────────────────────────────────────┐
│ [✏ Edit] [✨ AI: On] [✉ Resend Invite] [👤 Impersonate] [🗑 Delete] │
└────────────────────────────────────────────────────────┘
```

- Back link: `ArrowLeft` icon + "Back to Tenant Management", `Link` to
  `/admin`.
- Name/schema/badges header reuses the existing `PLAN_VARIANT`/
  `STATUS_VARIANT` maps — these move from `page.tsx` into a small shared
  spot both files import (`src/app/admin/_components/tenantVariants.ts`,
  the one net-new non-component file) rather than being duplicated.
- "AI Usage" card renders `AiUsageBreakdown` directly with `used`/`limit`/
  `byUser` looked up from the page's `aiUsage` map (same shape as today);
  if `limit === 0` (Starter/Pro have no AI allowance), show "AI usage
  tracking is not available on this plan" instead of the breakdown.

## Data flow

Unchanged network contracts. Sequence for a mutation from the detail page
(e.g. Toggle AI):

1. User clicks "AI: On" → opens `ConfirmActionModal` (tone `warning` if
   turning off, `success` if turning on) — no network call yet.
2. User confirms → `TenantDetailActions` PATCHes
   `/api/admin/tenants/[id]` exactly as `TenantActions.handleToggleAi` does
   today → toast → `onRefresh()` → detail page bumps `refreshKey` → both
   fetches re-run → card reflects the new state.

Impersonate: confirm → POST `/api/admin/impersonate` → same magic-link
redirect as today (`window.location.href = data.magicLink`) — the browser
navigates away, so no refetch is needed on success; on failure, close the
confirm modal's loading state and toast the error (currently `alert(...)`;
this becomes a toast for consistency with every other action on this page).

## Error handling

No new failure modes — every mutation already goes through the same API
routes with the same success/failure shapes. The only behavior change is
presentation: Impersonate's failure path moves from `alert()` to
`useToast().error(...)`, matching every other action in this feature.

## Testing

Per the working agreement, this is UI/presentation work with Supabase-backed
mutations — consistent with the existing note in `admin/CLAUDE.md` ("No test
suite targets this folder... Verify by using `/admin` in the browser"), no
new automated tests are added. Verify manually:

- Table shows the 6 columns, hamburger link navigates to
  `/admin/tenants/[id]`.
- Detail page: loading state, not-found state (garbage id in URL), loaded
  state with correct badges/fields.
- Each action's confirm modal (Toggle AI both directions, Impersonate) shows
  the right tone/message, cancels cleanly, and on confirm performs the same
  mutation as before.
- Resend Invite still fires with no confirmation, only visible when
  `status === "invited"`.
- Delete modal unchanged (type schema name to confirm).
- AI Usage modal still opens from the table's AI Usage cell and renders
  identically to before (via the extracted `AiUsageBreakdown`).

## Docs to update (same commit, per AGENTS.md)

- `src/app/admin/CLAUDE.md` — file map: add `tenants/[id]/page.tsx`,
  `_components/{ConfirmActionModal,AiUsageBreakdown,TenantDetailActions,
  tenantVariants}`, remove `TenantActions.tsx`; update `page.tsx`'s
  description (columns, hamburger link) and `AiUsageModal.tsx`'s
  description (now a thin wrapper).
- `src/app/admin/SKILL.md` — update "Edit an existing tenant" / "Change
  impersonation" minimal-file-set entries to point at
  `TenantDetailActions.tsx` instead of `TenantActions.tsx`; add a gotcha
  noting `ConfirmActionModal` vs. `DeleteConfirmModal` (reason field vs.
  none) so a future agent doesn't reach for the wrong one.
