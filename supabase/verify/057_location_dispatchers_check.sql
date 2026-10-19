-- Verifies 057 on one tenant. Replace tenant_boughtopia if needed.
-- Requires: advanced inventory enabled, ≥1 product, ≥1 own location, ≥1 active profile.
BEGIN;
SET LOCAL search_path = tenant_boughtopia, public;

WITH loc AS (SELECT id FROM stock_locations WHERE type <> 'dropship' AND is_active LIMIT 1),
     usr AS (SELECT id FROM profiles WHERE status = 'active' LIMIT 1)
UPDATE stock_locations SET dispatcher_id = (SELECT id FROM usr) WHERE id = (SELECT id FROM loc);

INSERT INTO sales (platform, product_name, product_id, quantity, unit_price, total_amount, currency, date, status, fulfillment_location_id)
SELECT 'other', 'verify-057', (SELECT id FROM products LIMIT 1), 1, 1, 1, 'EUR', current_date, 'pending',
       (SELECT id FROM stock_locations WHERE dispatcher_id IS NOT NULL LIMIT 1)
RETURNING id, dispatch_notified_at;            -- expect dispatch_notified_at NOT NULL

SELECT count(*) AS notif FROM notifications
 WHERE type = 'inventory.dispatch_assigned' AND body LIKE '1 × verify-057%';   -- expect 1
SELECT count(*) AS outbox FROM dispatch_email_outbox o
  JOIN sales s ON s.id = o.sale_id WHERE s.product_name = 'verify-057';         -- expect 1

-- Re-saving must not re-notify:
UPDATE sales SET description = 'touch' WHERE product_name = 'verify-057';
SELECT count(*) AS outbox_after_touch FROM dispatch_email_outbox o
  JOIN sales s ON s.id = o.sale_id WHERE s.product_name = 'verify-057';         -- expect 1
ROLLBACK;
