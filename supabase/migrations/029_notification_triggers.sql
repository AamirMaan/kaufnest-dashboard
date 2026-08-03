-- ============================================================
-- 029 — Notification triggers
--
-- WHY TRIGGERS, NOT APPLICATION CODE: events arrive through paths the UI does
-- not own — the integration order-import route, the CSV import modals, and the
-- eBay message sync all write directly to these tables. App-side calls next to
-- writeAuditLog() would miss all three, and the symptom would look like
-- "notifications randomly don't fire for eBay orders".
--
-- These are NEW, SEPARATE triggers. They do NOT modify
-- apply_purchase_stock_change / apply_sale_stock_change (002), which own all
-- stock arithmetic and are the riskiest code in the schema.
--
-- All functions are SECURITY DEFINER so they can insert into `notifications`,
-- which has no insert policy for `authenticated` — users must never be able to
-- forge a notification. search_path is pinned on every one.
-- ============================================================

select public.run_on_all_tenant_schemas($$
  -- ── sale.created ──────────────────────────────────────────
  create or replace function {{schema}}.notify_sale_created()
  returns trigger language plpgsql security definer
  set search_path = {{schema}}, public
  as $fn$
  begin
    insert into {{schema}}.notifications
      (type, category, entity_type, entity_id, title, body, link,
       payload, actor_id, visible_to_roles, required_permission)
    values (
      'sale.created', 'orders', 'sale', new.id,
      'New order: ' || new.product_name,
      new.quantity || ' × ' || new.product_name || ' — '
        || new.total_amount || ' ' || new.currency,
      '/dashboard/sales/' || new.id,
      jsonb_build_object(
        'platform',     new.platform,
        'quantity',     new.quantity,
        'total_amount', new.total_amount,
        'currency',     new.currency
      ),
      new.created_by,
      array['super_admin','admin','accountant'],
      null
    );
    return new;
  end;
  $fn$;

  drop trigger if exists notify_sale_created on {{schema}}.sales;
  create trigger notify_sale_created
    after insert on {{schema}}.sales
    for each row execute function {{schema}}.notify_sale_created();

  -- ── purchase.created ──────────────────────────────────────
  create or replace function {{schema}}.notify_purchase_created()
  returns trigger language plpgsql security definer
  set search_path = {{schema}}, public
  as $fn$
  begin
    insert into {{schema}}.notifications
      (type, category, entity_type, entity_id, title, body, link,
       payload, actor_id, visible_to_roles, required_permission)
    values (
      'purchase.created', 'purchases', 'purchase', new.id,
      'New purchase: ' || new.product_name,
      new.quantity || ' × ' || new.product_name || ' — '
        || new.total_amount || ' ' || new.currency,
      '/dashboard/purchases',
      jsonb_build_object(
        'quantity',     new.quantity,
        'total_amount', new.total_amount,
        'currency',     new.currency,
        'vendor',       new.vendor
      ),
      new.created_by,
      array['super_admin','admin','accountant'],
      null
    );
    return new;
  end;
  $fn$;

  drop trigger if exists notify_purchase_created on {{schema}}.purchases;
  create trigger notify_purchase_created
    after insert on {{schema}}.purchases
    for each row execute function {{schema}}.notify_purchase_created();

  -- ── product.low_stock ─────────────────────────────────────
  -- Fires ONLY on the downward crossing. Selling ten more units below the
  -- threshold produces nothing further, and the condition re-arms by itself
  -- when a purchase lifts stock back above the threshold. No state column.
  create or replace function {{schema}}.notify_low_stock()
  returns trigger language plpgsql security definer
  set search_path = {{schema}}, public
  as $fn$
  begin
    if new.reorder_threshold is not null
       and new.current_stock <= new.reorder_threshold
       and (old.reorder_threshold is null
            or old.current_stock > old.reorder_threshold) then
      insert into {{schema}}.notifications
        (type, category, entity_type, entity_id, title, body, link,
         payload, actor_id, visible_to_roles, required_permission)
      values (
        'product.low_stock', 'inventory', 'product', new.id,
        'Low stock: ' || new.name,
        new.current_stock || ' left (threshold ' || new.reorder_threshold || ')',
        '/dashboard/inventory',
        jsonb_build_object(
          'sku',               new.sku,
          'current_stock',     new.current_stock,
          'reorder_threshold', new.reorder_threshold
        ),
        null,
        array['super_admin','admin','accountant'],
        null
      );
    end if;
    return new;
  end;
  $fn$;

  drop trigger if exists notify_low_stock on {{schema}}.products;
  create trigger notify_low_stock
    after update on {{schema}}.products
    for each row execute function {{schema}}.notify_low_stock();

  -- ── message.received ──────────────────────────────────────
  -- Inbound only. actor_id is null: the actor is an external buyer, not a
  -- tenant user. Visible to admins by role, and to anyone granted the
  -- `manage_messages` override.
  create or replace function {{schema}}.notify_message_received()
  returns trigger language plpgsql security definer
  set search_path = {{schema}}, public
  as $fn$
  begin
    if new.direction = 'inbound' then
      insert into {{schema}}.notifications
        (type, category, entity_type, entity_id, title, body, link,
         payload, actor_id, visible_to_roles, required_permission)
      values (
        'message.received', 'messages', 'message', new.id,
        'New message from ' || new.buyer_username,
        coalesce(new.subject, left(new.body, 120)),
        '/dashboard/messages',
        jsonb_build_object(
          'buyer_username', new.buyer_username,
          'item_id',        new.item_id,
          'subject',        new.subject
        ),
        null,
        array['super_admin','admin'],
        'manage_messages'
      );
    end if;
    return new;
  end;
  $fn$;

  drop trigger if exists notify_message_received on {{schema}}.ebay_messages;
  create trigger notify_message_received
    after insert on {{schema}}.ebay_messages
    for each row execute function {{schema}}.notify_message_received();
$$);
