ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS qty_canceled_manual INT NOT NULL DEFAULT 0 AFTER qty_canceled_backorder;

UPDATE order_items
SET qty_canceled_manual = 0
WHERE qty_canceled_manual IS NULL;

