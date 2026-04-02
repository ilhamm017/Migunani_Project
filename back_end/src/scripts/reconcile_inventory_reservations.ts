import mysql from 'mysql2/promise';
import { loadEnv } from '../config/env';

type ResultRow = { label: string; value: number };

const TERMINAL_ORDER_STATUSES = new Set(['completed', 'canceled', 'expired']);

const toNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const main = async () => {
  loadEnv();

  const host = process.env.DB_HOST || '127.0.0.1';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASS || 'password';
  const database = process.env.DB_NAME || 'migunani_motor_db';
  const port = Number(process.env.DB_PORT || 3306);

  const conn = await mysql.createConnection({
    host,
    user,
    password,
    database,
    port,
    multipleStatements: true,
  });

  const terminalList = Array.from(TERMINAL_ORDER_STATUSES.values()).map(() => '?').join(',');

  try {
    console.log('[reconcile_inventory_reservations] Start');

    await conn.beginTransaction();

    // Count candidates before delete
    const [beforeRows] = await conn.query(
      `
      SELECT
        SUM(CASE WHEN o.id IS NULL THEN 1 ELSE 0 END) AS orphan_orders,
        SUM(CASE WHEN oi.id IS NULL THEN 1 ELSE 0 END) AS orphan_order_items,
        SUM(CASE WHEN p.id IS NULL THEN 1 ELSE 0 END) AS orphan_products,
        SUM(CASE WHEN b.id IS NULL THEN 1 ELSE 0 END) AS orphan_batches,
        SUM(CASE WHEN o.id IS NOT NULL AND o.status IN (${terminalList}) THEN 1 ELSE 0 END) AS terminal_orders,
        COUNT(*) AS total
      FROM inventory_batch_reservations r
      LEFT JOIN orders o ON o.id = r.order_id
      LEFT JOIN order_items oi ON oi.id = r.order_item_id
      LEFT JOIN products p ON p.id = r.product_id
      LEFT JOIN inventory_batches b ON b.id = r.batch_id
      `,
      Array.from(TERMINAL_ORDER_STATUSES.values())
    );
    const before = (beforeRows as any[])[0] || {};

    // Delete unsafe reservations
    const [deleteResult] = await conn.query(
      `
      DELETE r
      FROM inventory_batch_reservations r
      LEFT JOIN orders o ON o.id = r.order_id
      LEFT JOIN order_items oi ON oi.id = r.order_item_id
      LEFT JOIN products p ON p.id = r.product_id
      LEFT JOIN inventory_batches b ON b.id = r.batch_id
      WHERE
        o.id IS NULL
        OR oi.id IS NULL
        OR p.id IS NULL
        OR b.id IS NULL
        OR (o.status IN (${terminalList}))
      `,
      Array.from(TERMINAL_ORDER_STATUSES.values())
    );

    // Resync batch reserved to SUM(reservations), capped to qty_on_hand
    await conn.query(`
      UPDATE inventory_batches b
      LEFT JOIN (
        SELECT batch_id, SUM(qty_reserved) AS qty
        FROM inventory_batch_reservations
        GROUP BY batch_id
      ) s ON s.batch_id = b.id
      SET b.qty_reserved = LEAST(b.qty_on_hand, COALESCE(s.qty, 0));
    `);

    await conn.commit();

    const deleted = toNumber((deleteResult as any)?.affectedRows || 0);
    console.log('[reconcile_inventory_reservations] Deleted rows:', deleted);
    console.log('[reconcile_inventory_reservations] Breakdown:', {
      orphan_orders: toNumber(before.orphan_orders),
      orphan_order_items: toNumber(before.orphan_order_items),
      orphan_products: toNumber(before.orphan_products),
      orphan_batches: toNumber(before.orphan_batches),
      terminal_orders: toNumber(before.terminal_orders),
      total_before: toNumber(before.total),
    });
    console.log('[reconcile_inventory_reservations] Done');
  } catch (error) {
    try {
      await conn.rollback();
    } catch {}
    console.error('[reconcile_inventory_reservations] Failed:', error);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
};

main();

