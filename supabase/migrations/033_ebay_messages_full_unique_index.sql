-- ============================================================
-- 033 — make idx_ebay_messages_external_id a full (non-partial) unique index
--
-- Migration 026 created it PARTIAL: `WHERE external_message_id IS NOT NULL`,
-- intending only to let multiple locally-created outbound rows (which never
-- carry an eBay MessageID) coexist. That's unnecessary — Postgres never
-- treats two NULLs as conflicting under a plain UNIQUE index either — and it
-- broke the one thing this index exists for: `sync/route.ts`'s
-- `.upsert(rows, { onConflict: "external_message_id" })` compiles to a plain
-- `ON CONFLICT (external_message_id)` with no predicate, and Postgres will
-- not infer a PARTIAL unique index for that without the ON CONFLICT clause
-- repeating the exact WHERE predicate — which Supabase's `.upsert()` has no
-- way to express. Every sync failed at the upsert step with "there is no
-- unique or exclusion constraint matching the ON CONFLICT specification"
-- (42P10), 100% reproducibly, confirmed live 2026-08-27 across all 5 tenant
-- schemas (identical partial-index definition in each — not tenant drift).
--
-- Verified live before writing this: `ebay_messages` was empty in every
-- tenant (the upsert's ON CONFLICT error means the whole statement fails
-- before writing any row), so converting to a full unique index has zero
-- duplicate-data risk.
--
-- Also mirrored into provision_tenant_schema() (005) — the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  drop index if exists {{schema}}.idx_ebay_messages_external_id;
  create unique index if not exists idx_ebay_messages_external_id
    on {{schema}}.ebay_messages (external_message_id);
$$);
