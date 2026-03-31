-- MANUAL_ONLY
-- Backfill customer_balance_entries for existing POS underpay (hutang) sales so they appear in Info Customer page.
-- Safe to re-run: uses idempotency_key guard.

INSERT INTO customer_balance_entries
  (customer_id, amount, entry_type, reference_type, reference_id, note, created_by, idempotency_key, createdAt, updatedAt)
SELECT
  ps.customer_id,
  -ROUND((ps.total - ps.amount_received), 2) AS amount,
  'pos_underpay' AS entry_type,
  'pos_sale' AS reference_type,
  ps.id AS reference_id,
  CONCAT(
    'Backfill hutang POS ',
    COALESCE(ps.receipt_number, RIGHT(ps.id, 8)),
    ': total=',
    ps.total,
    ', diterima=',
    ps.amount_received,
    '.'
  ) AS note,
  ps.cashier_user_id AS created_by,
  CONCAT('balance_pos_underpay_', ps.id) AS idempotency_key,
  COALESCE(ps.paid_at, ps.createdAt, NOW()) AS createdAt,
  NOW() AS updatedAt
FROM pos_sales ps
WHERE ps.status = 'paid'
  AND ps.change_amount < 0
  AND ps.customer_id IS NOT NULL
  AND ROUND((ps.total - ps.amount_received), 2) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM customer_balance_entries e
    WHERE e.idempotency_key = CONCAT('balance_pos_underpay_', ps.id)
  );

