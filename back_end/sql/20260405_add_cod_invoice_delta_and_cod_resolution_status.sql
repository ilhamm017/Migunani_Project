-- Add per-invoice COD delta ledger type + invoice COD resolution status.
-- Safe to run multiple times.

-- 1) Extend customer_balance_entries.entry_type enum with 'cod_invoice_delta'
SET @table_name := 'customer_balance_entries';
SET @col_name := 'entry_type';

SELECT COLUMN_TYPE
INTO @current_enum
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = @table_name
  AND COLUMN_NAME = @col_name
LIMIT 1;

SET @needs_alter := IF(@current_enum IS NULL, 0, 1);
SET @has_cod_invoice_delta := IF(@current_enum LIKE "%'cod_invoice_delta'%", 1, 0);
SET @should_alter := IF(@needs_alter = 1 AND @has_cod_invoice_delta = 0, 1, 0);

SET @sql := IF(
  @should_alter = 1,
  "ALTER TABLE customer_balance_entries MODIFY entry_type ENUM('payment_delta_non_cod','cod_settlement_delta','cod_invoice_delta','pos_underpay','pos_underpay_refund','credit_note_posted','credit_note_refund_paid','manual_payment','manual_refund','manual_adjustment') NOT NULL",
  "SELECT 'skip: customer_balance_entries.entry_type already contains cod_invoice_delta' AS info"
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Add invoices.cod_resolution_status (nullable)
SET @has_col := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoices'
    AND COLUMN_NAME = 'cod_resolution_status'
);

SET @sql2 := IF(
  @has_col = 0,
  "ALTER TABLE invoices ADD COLUMN cod_resolution_status VARCHAR(32) NULL AFTER payment_status",
  "SELECT 'skip: invoices.cod_resolution_status already exists' AS info"
);

PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

