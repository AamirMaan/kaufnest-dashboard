-- ============================================================
-- 034 — capture item title/price/link on ebay_messages
--
-- GetMemberMessages' <MemberMessageExchange><Item> block already carries
-- Title, SellingStatus/CurrentPrice (with a currencyID attribute), and
-- ViewItemURL — confirmed live 2026-08-27 against a real synced account
-- (see the schema-mismatch investigation in dashboard/messages/SKILL.md).
-- The app was discarding all of it and extracting only <ItemID>, so the
-- Messages UI could show nothing better than a bare numeric item id.
--
-- Nullable and denormalized onto every message row (not a separate items
-- table) — the same Item block already repeats identically across every
-- message about that item in eBay's own response, so this just keeps what
-- was already being redundantly sent rather than adding real duplication.
-- Existing rows get NULL until their next sync; the UI falls back to the
-- bare item id when item_title is null, exactly like today.
--
-- Also mirrored into provision_tenant_schema() (005) — the 2-places rule.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  alter table {{schema}}.ebay_messages
    add column if not exists item_title    text,
    add column if not exists item_price    numeric(12,2),
    add column if not exists item_currency text,
    add column if not exists item_url      text;
$$);
