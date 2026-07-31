-- ============================================================
-- eBay member messages — every tenant schema (run_on_all_tenant_schemas)
-- Run this in the Supabase SQL editor for Project B, AFTER 012 (helper) is
-- applied.
--
-- Backs the Messages feature (src/app/dashboard/messages/,
-- src/lib/integrations/ebay/messages.ts) — synced buyer<->seller messages
-- via the eBay Trading API (GetMemberMessages / AddMemberMessageRTQ), same
-- OAuth connection/scope as the Listings feature's Trading API calls.
--
-- external_message_id is nullable because it's set from eBay's MessageID on
-- inbound sync; outbound rows created locally right after a successful
-- AddMemberMessageRTQ call don't get one back from eBay synchronously.
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql), so
-- every NEW tenant gets this table from the start.
-- ============================================================

SELECT public.run_on_all_tenant_schemas($$
  CREATE TABLE IF NOT EXISTS {{schema}}.ebay_messages (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    external_message_id   text,
    item_id                text NOT NULL,
    buyer_username         text NOT NULL,
    direction              text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    subject                text,
    body                   text NOT NULL,
    question_type          text,
    is_read                boolean NOT NULL DEFAULT false,
    ebay_created_at        timestamptz NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
  );

  CREATE OR REPLACE TRIGGER set_ebay_messages_updated_at
    BEFORE UPDATE ON {{schema}}.ebay_messages
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

  CREATE UNIQUE INDEX IF NOT EXISTS idx_ebay_messages_external_id
    ON {{schema}}.ebay_messages (external_message_id)
    WHERE external_message_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_ebay_messages_thread
    ON {{schema}}.ebay_messages (buyer_username, item_id, ebay_created_at);

  ALTER TABLE {{schema}}.ebay_messages ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "ebay_messages_all_admin" ON {{schema}}.ebay_messages;
  CREATE POLICY "ebay_messages_all_admin" ON {{schema}}.ebay_messages
    FOR ALL
    USING ({{schema}}.is_tenant_member() AND {{schema}}.current_user_role() IN ('admin', 'super_admin'))
    WITH CHECK ({{schema}}.is_tenant_member() AND {{schema}}.current_user_role() IN ('admin', 'super_admin'));
$$);
