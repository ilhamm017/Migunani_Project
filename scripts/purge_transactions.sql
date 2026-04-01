-- Purge transactional data (keep master/reference tables like users/products/categories/settings/accounts).
-- This script is intended for resetting the environment so customers have 0 transactions and no points/history.
--
-- Usage (from repo root):
--   sudo docker compose exec -T mysql mysql -uroot -ppassword migunani_motor_db < scripts/purge_transactions.sql

USE migunani_motor_db;

SET FOREIGN_KEY_CHECKS = 0;

-- --- Transactional / history tables ---
TRUNCATE TABLE audit_logs;
TRUNCATE TABLE accounting_periods;
TRUNCATE TABLE backorders;
TRUNCATE TABLE cart_items;
TRUNCATE TABLE carts;
TRUNCATE TABLE chat_sessions;
TRUNCATE TABLE chat_thread_members;
TRUNCATE TABLE chat_threads;
TRUNCATE TABLE messages;
TRUNCATE TABLE cod_collections;
TRUNCATE TABLE cod_settlements;
TRUNCATE TABLE credit_note_lines;
TRUNCATE TABLE credit_notes;
TRUNCATE TABLE customer_balance_entries;
TRUNCATE TABLE delivery_handover_items;
TRUNCATE TABLE delivery_handovers;
TRUNCATE TABLE driver_balance_adjustments;
TRUNCATE TABLE driver_debt_adjustments;
TRUNCATE TABLE expenses;
TRUNCATE TABLE idempotency_keys;
TRUNCATE TABLE inventory_batch_consumptions;
TRUNCATE TABLE inventory_batch_reservations;
TRUNCATE TABLE inventory_batches;
TRUNCATE TABLE inventory_cost_ledger;
TRUNCATE TABLE invoice_cost_overrides;
TRUNCATE TABLE invoice_items;
TRUNCATE TABLE invoices;
TRUNCATE TABLE journal_lines;
TRUNCATE TABLE journals;
TRUNCATE TABLE notification_outbox;
TRUNCATE TABLE order_allocations;
TRUNCATE TABLE order_events;
TRUNCATE TABLE order_issues;
TRUNCATE TABLE order_items;
TRUNCATE TABLE orders;
TRUNCATE TABLE pos_sale_items;
TRUNCATE TABLE pos_sales;
TRUNCATE TABLE purchase_order_items;
TRUNCATE TABLE purchase_orders;
TRUNCATE TABLE retur_handover_items;
TRUNCATE TABLE retur_handovers;
TRUNCATE TABLE returs;
TRUNCATE TABLE shifts;
TRUNCATE TABLE stock_mutations;
TRUNCATE TABLE stock_opname_items;
TRUNCATE TABLE stock_opnames;
TRUNCATE TABLE supplier_invoices;
TRUNCATE TABLE supplier_payments;
TRUNCATE TABLE supplier_preorder_items;
TRUNCATE TABLE supplier_preorders;

-- --- Reset derived counters / customer state ---
UPDATE customer_profiles
SET points = 0,
    tier = 'regular';

UPDATE users
SET debt = 0.00
WHERE role IN ('driver', 'customer');

UPDATE products
SET allocated_quantity = 0
WHERE allocated_quantity <> 0;

SET FOREIGN_KEY_CHECKS = 1;

