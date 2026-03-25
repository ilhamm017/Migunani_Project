-- Add COD settlement audit columns used by driver-deposit history.
-- Idempotent: safe to run multiple times.

SET @db := DATABASE();

SET @has_total_expected := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'cod_settlements'
    AND COLUMN_NAME = 'total_expected'
);

SET @has_diff_amount := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'cod_settlements'
    AND COLUMN_NAME = 'diff_amount'
);

SET @has_debt_before := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'cod_settlements'
    AND COLUMN_NAME = 'driver_debt_before'
);

SET @has_debt_after := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'cod_settlements'
    AND COLUMN_NAME = 'driver_debt_after'
);

SET @has_invoice_ids_json := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'cod_settlements'
    AND COLUMN_NAME = 'invoice_ids_json'
);

SET @sql_total_expected := IF(
  @has_total_expected = 0,
  'ALTER TABLE cod_settlements ADD COLUMN total_expected DECIMAL(15, 2) NULL AFTER total_amount',
  'SELECT \"skip: cod_settlements.total_expected exists\"'
);
PREPARE stmt_total_expected FROM @sql_total_expected;
EXECUTE stmt_total_expected;
DEALLOCATE PREPARE stmt_total_expected;

SET @sql_diff_amount := IF(
  @has_diff_amount = 0,
  'ALTER TABLE cod_settlements ADD COLUMN diff_amount DECIMAL(15, 2) NULL AFTER total_expected',
  'SELECT \"skip: cod_settlements.diff_amount exists\"'
);
PREPARE stmt_diff_amount FROM @sql_diff_amount;
EXECUTE stmt_diff_amount;
DEALLOCATE PREPARE stmt_diff_amount;

SET @sql_debt_before := IF(
  @has_debt_before = 0,
  'ALTER TABLE cod_settlements ADD COLUMN driver_debt_before DECIMAL(15, 2) NULL AFTER diff_amount',
  'SELECT \"skip: cod_settlements.driver_debt_before exists\"'
);
PREPARE stmt_debt_before FROM @sql_debt_before;
EXECUTE stmt_debt_before;
DEALLOCATE PREPARE stmt_debt_before;

SET @sql_debt_after := IF(
  @has_debt_after = 0,
  'ALTER TABLE cod_settlements ADD COLUMN driver_debt_after DECIMAL(15, 2) NULL AFTER driver_debt_before',
  'SELECT \"skip: cod_settlements.driver_debt_after exists\"'
);
PREPARE stmt_debt_after FROM @sql_debt_after;
EXECUTE stmt_debt_after;
DEALLOCATE PREPARE stmt_debt_after;

SET @sql_invoice_ids_json := IF(
  @has_invoice_ids_json = 0,
  'ALTER TABLE cod_settlements ADD COLUMN invoice_ids_json TEXT NULL AFTER driver_debt_after',
  'SELECT \"skip: cod_settlements.invoice_ids_json exists\"'
);
PREPARE stmt_invoice_ids_json FROM @sql_invoice_ids_json;
EXECUTE stmt_invoice_ids_json;
DEALLOCATE PREPARE stmt_invoice_ids_json;

