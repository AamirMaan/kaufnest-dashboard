---
name: lib-supabase
description: Reference for the Supabase client factories in src/lib/supabase (client.ts, server.ts) — use when wiring up a new Supabase call site or wondering which client to import in Client vs. Server Components/Actions/Route Handlers.
---

# Supabase clients (`src/lib/supabase/`)

Two thin factories around `@supabase/ssr`, split by execution context. Both
read `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from env —
there's nothing else to configure here.

## client.ts

`export function createClient()` — wraps `createBrowserClient`. Use in Client
Components (`"use client"`) and other browser-side code. Synchronous.

## server.ts

`export async function createClient()` — wraps `createServerClient`, reading/
writing auth cookies via `next/headers` `cookies()`. **Async** — always
`await createClient()`. Use in Server Components, Server Actions, and Route
Handlers.

- The `setAll` cookie writer is wrapped in `try/catch` and swallows errors —
  this is expected when called from a Server Component (cookies can only be
  set in a Server Action/Route Handler/middleware); the comment in the file
  explains middleware handles it in that case.

## Gotcha: `src/proxy.ts` doesn't use either of these

The route-protection proxy (this project's middleware-equivalent — see the
`AGENTS.md` note about this Next.js version's breaking changes) builds its
own inline `createServerClient` instead of importing `server.ts`. That's
because middleware needs to mutate cookies directly on the in-flight
`NextRequest`/`NextResponse` pair, which `cookies()` from `next/headers`
can't do. If you change the cookie-handling shape in `server.ts`, check
whether `src/proxy.ts` needs the same treatment.

## Where these are used

Every feature that reads/writes Supabase imports one of these — pages and
`_components/*Modal.tsx` files use `client.ts` (they're Client Components),
while `app/auth/callback/route.ts` and `app/api/users/invite/route.ts` use
`server.ts`. `DashboardShell` and `dashboard/layout.tsx` also use the server
client for the auth-guard/data-hydration pass.
