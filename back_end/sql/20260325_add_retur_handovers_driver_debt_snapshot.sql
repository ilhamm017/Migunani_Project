-- Add driver debt snapshot fields for retur handover history/audit.
-- Required by: ReturHandover model + driver-deposit history endpoints.
--
-- Idempotent: safe to run multiple times (no-op if columns already exist).

SET @db := DATABASE();

SET @has_before := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'retur_handovers'
    AND COLUMN_NAME = 'driver_debt_before'
);

SET @has_after := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'retur_handovers'
    AND COLUMN_NAME = 'driver_debt_after'
);

SET @sql_before := IF(
  @has_before = 0,
  'ALTER TABLE retur_handovers ADD COLUMN driver_debt_before DECIMAL(15, 2) NULL AFTER note',
  'SELECT \"skip: retur_handovers.driver_debt_before exists\"'
);
PREPARE stmt_before FROM @sql_before;
EXECUTE stmt_before;
DEALLOCATE PREPARE stmt_before;

SET @sql_after := IF(
  @has_after = 0,
  'ALTER TABLE retur_handovers ADD COLUMN driver_debt_after DECIMAL(15, 2) NULL AFTER driver_debt_before',
  'SELECT \"skip: retur_handovers.driver_debt_after exists\"'
);
PREPARE stmt_after FROM @sql_after;
EXECUTE stmt_after;
DEALLOCATE PREPARE stmt_after;
