-- Verifies 057 on one tenant. Replace tenant_boughtopia if needed.
-- Requires: advanced inventory enabled, ≥1 product, ≥2 own active locations, ≥1 active profile.
BEGIN;
SET LOCAL search_path = tenant_boughtopia, public;

CREATE TEMP TABLE v057 ON COMMIT DROP AS
SELECT (SELECT id FROM stock_locations WHERE type <> 'dropship' AND is_active ORDER BY id LIMIT 1) AS loc_a,
       (SELECT id FROM stock_locations WHERE type <> 'dropship' AND is_active ORDER BY id OFFSET 1 LIMIT 1) AS loc_b,
       (SELECT id FROM profiles WHERE status = 'active' LIMIT 1) AS usr;

UPDATE stock_locations SET dispatcher_id = (SELECT usr FROM v057) WHERE id = (SELECT loc_a FROM v057);
UPDATE stock_locations SET dispatcher_id = NULL WHERE id = (SELECT loc_b FROM v057);

-- Case 1: insert at the dispatched location -> notified once.
INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, currency, date, status, fulfillment_location_id)
SELECT 'other', 'verify-057', (SELECT id FROM products LIMIT 1), 1, 1, 1, 'EUR', current_date, 'pending',
       (SELECT loc_a FROM v057)
RETURNING id, dispatch_notified_at;            -- expect dispatch_notified_at NOT NULL

SELECT count(*) AS notif FROM notifications
 WHERE type = 'inventory.dispatch_assigned' AND body LIKE '1 × verify-057%';   -- expect 1
SELECT count(*) AS outbox FROM dispatch_email_outbox o
  JOIN sales s ON s.id = o.sale_id WHERE s.product_name = 'verify-057';         -- expect 1

-- Re-saving must not re-notify:
UPDATE sales SET description = 'touch' WHERE product_name = 'verify-057';
SELECT count(*) AS outbox_after_touch FROM dispatch_email_outbox o
  JOIN sales s ON s.id = o.sale_id WHERE s.product_name = 'verify-057';         -- expect 1

-- Case 2: open order at a location with NO dispatcher; assigning one later
-- and then touching the order must NOT back-date a notification.
INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, currency, date, status, fulfillment_location_id)
SELECT 'other', 'verify-057-b', (SELECT id FROM products LIMIT 1), 1, 1, 1, 'EUR', current_date, 'pending',
       (SELECT loc_b FROM v057);
UPDATE stock_locations SET dispatcher_id = (SELECT usr FROM v057) WHERE id = (SELECT loc_b FROM v057);
UPDATE sales SET description = 'touch' WHERE product_name = 'verify-057-b';
SELECT count(*) AS outbox_b_after_touch FROM dispatch_email_outbox o
  JOIN sales s ON s.id = o.sale_id WHERE s.product_name = 'verify-057-b';       -- expect 0

-- Moving it to the dispatched location (a location change) notifies.
UPDATE sales SET fulfillment_location_id = (SELECT loc_a FROM v057) WHERE product_name = 'verify-057-b';
SELECT count(*) AS outbox_b_after_move FROM dispatch_email_outbox o
  JOIN sales s ON s.id = o.sale_id WHERE s.product_name = 'verify-057-b';       -- expect 1
ROLLBACK;
