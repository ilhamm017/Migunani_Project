-- NOTE: MySQL 8 does not support `ADD COLUMN IF NOT EXISTS`.
-- This migration is written to be idempotent via information_schema checks.

SET @db := DATABASE();

SET @has_ordered_qty_original := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'ordered_qty_original'
);

SET @ddl := IF(
  @has_ordered_qty_original = 0,
  'ALTER TABLE `order_items` ADD COLUMN `ordered_qty_original` INT NOT NULL DEFAULT 0 AFTER `qty`',
  'SELECT \"skip order_items.ordered_qty_original\"'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_qty_canceled_backorder := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'qty_canceled_backorder'
);

SET @ddl := IF(
  @has_qty_canceled_backorder = 0,
  'ALTER TABLE `order_items` ADD COLUMN `qty_canceled_backorder` INT NOT NULL DEFAULT 0 AFTER `ordered_qty_original`',
  'SELECT \"skip order_items.qty_canceled_backorder\"'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE order_items
SET ordered_qty_original = qty
WHERE ordered_qty_original IS NULL OR ordered_qty_original <= 0;

CREATE TABLE IF NOT EXISTS order_events (
    id CHAR(36) NOT NULL PRIMARY KEY,
    order_id CHAR(36) NOT NULL,
    order_item_id BIGINT NULL,
    invoice_id CHAR(36) NULL,
    event_type ENUM(
        'allocation_set',
        'invoice_issued',
        'invoice_item_billed',
        'backorder_opened',
        'backorder_reallocated',
        'backorder_canceled',
        'order_status_changed'
    ) NOT NULL,
    payload JSON NULL,
    reason TEXT NULL,
    actor_user_id CHAR(36) NULL,
    actor_role VARCHAR(50) NULL,
    occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_order_events_order_id (order_id),
    INDEX idx_order_events_order_item_id (order_item_id),
    INDEX idx_order_events_invoice_id (invoice_id),
    INDEX idx_order_events_event_type (event_type),
    INDEX idx_order_events_occurred_at (occurred_at),
    CONSTRAINT fk_order_events_order
        FOREIGN KEY (order_id) REFERENCES orders(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_order_events_order_item
        FOREIGN KEY (order_item_id) REFERENCES order_items(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_order_events_invoice
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_order_events_actor_user
        FOREIGN KEY (actor_user_id) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
);
