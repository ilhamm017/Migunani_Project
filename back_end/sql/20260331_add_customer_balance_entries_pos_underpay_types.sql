-- Add new entry_type values for customer_balance_entries to track POS underpay (hutang) and its refund reversal.
-- Safe to run multiple times: checks current column definition first.

SET @table_name := 'customer_balance_entries';
SET @col_name := 'entry_type';

SELECT COLUMN_TYPE
INTO @current_enum
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = @table_name
  AND COLUMN_NAME = @col_name
LIMIT 1;

-- If table/column not found, do nothing.
SET @needs_alter := IF(@current_enum IS NULL, 0, 1);

-- Only attempt alter when enum does not already include our new values.
SET @has_pos_underpay := IF(@current_enum LIKE "%'pos_underpay'%", 1, 0);
SET @has_pos_underpay_refund := IF(@current_enum LIKE "%'pos_underpay_refund'%", 1, 0);

SET @should_alter := IF(@needs_alter = 1 AND (@has_pos_underpay = 0 OR @has_pos_underpay_refund = 0), 1, 0);

SET @sql := IF(
  @should_alter = 1,
  "ALTER TABLE customer_balance_entries MODIFY entry_type ENUM('payment_delta_non_cod','cod_settlement_delta','pos_underpay','pos_underpay_refund','credit_note_posted','credit_note_refund_paid','manual_payment','manual_refund','manual_adjustment') NOT NULL",
  "SELECT 'skip: customer_balance_entries.entry_type already up to date' AS info"
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

