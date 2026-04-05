import { sequelize } from '../models';

type FkSpec = {
  name: string;
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
  onDelete: 'RESTRICT' | 'SET NULL' | 'CASCADE';
  onUpdate: 'CASCADE' | 'RESTRICT';
  ensureIndexName?: string;
};

const q = async (sql: string, replacements?: any) => {
  return sequelize.query(sql, replacements ? { replacements } : undefined);
};

const tableExists = async (table: string) => {
  const [rows] = await q(
    `SELECT 1 AS ok
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
     LIMIT 1`,
    { table }
  ) as any;
  return Array.isArray(rows) && rows.length > 0;
};

const getColumnMeta = async (table: string, column: string) => {
  const [rows] = await q(
    `SELECT COLUMN_TYPE AS columnType,
            CHARACTER_SET_NAME AS charsetName,
            COLLATION_NAME AS collationName,
            IS_NULLABLE AS isNullable
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND COLUMN_NAME = :column
     LIMIT 1`,
    { table, column }
  ) as any;
  const row = rows?.[0];
  return row
    ? {
      columnType: String(row.columnType || ''),
      charsetName: row.charsetName === null ? null : String(row.charsetName),
      collationName: row.collationName === null ? null : String(row.collationName),
      isNullable: String(row.isNullable || '').toUpperCase() === 'YES',
    }
    : null;
};

const ensureChildTypeMatchesParent = async (childTable: string, childColumn: string, parentTable: string, parentColumn: string) => {
  const parent = await getColumnMeta(parentTable, parentColumn);
  const child = await getColumnMeta(childTable, childColumn);
  if (!parent || !child) return;
  if (parent.columnType === child.columnType && parent.collationName === child.collationName && parent.charsetName === child.charsetName) return;

  const nullSql = child.isNullable ? 'NULL' : 'NOT NULL';
  const charsetSql = parent.charsetName ? `CHARACTER SET ${parent.charsetName}` : '';
  const collSql = parent.collationName ? `COLLATE ${parent.collationName}` : '';
  await q(`ALTER TABLE \`${childTable}\` MODIFY COLUMN \`${childColumn}\` ${parent.columnType} ${charsetSql} ${collSql} ${nullSql}`);
};

const fkExists = async (constraintName: string) => {
  const [rows] = await q(
    `SELECT 1 AS ok
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND CONSTRAINT_NAME = :name
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'
     LIMIT 1`,
    { name: constraintName }
  ) as any;
  return Array.isArray(rows) && rows.length > 0;
};

const fkExistsOnColumn = async (table: string, column: string) => {
  const [rows] = await q(
    `SELECT 1 AS ok
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND COLUMN_NAME = :column
       AND REFERENCED_TABLE_NAME IS NOT NULL
     LIMIT 1`,
    { table, column }
  ) as any;
  return Array.isArray(rows) && rows.length > 0;
};

const indexExists = async (table: string, indexName: string) => {
  const [rows] = await q(
    `SELECT 1 AS ok
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND INDEX_NAME = :indexName
     LIMIT 1`,
    { table, indexName }
  ) as any;
  return Array.isArray(rows) && rows.length > 0;
};

const uniqueIndexExists = async (table: string, indexName: string) => {
  const [rows] = await q(
    `SELECT 1 AS ok
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND INDEX_NAME = :indexName
       AND NON_UNIQUE = 0
     LIMIT 1`,
    { table, indexName }
  ) as any;
  return Array.isArray(rows) && rows.length > 0;
};

const ensureIndex = async (table: string, indexName: string, columnsSql: string) => {
  if (await indexExists(table, indexName)) return;
  await q(`CREATE INDEX \`${indexName}\` ON \`${table}\` (${columnsSql})`);
};

const ensureUniqueIndex = async (table: string, indexName: string, columnsSql: string) => {
  if (await uniqueIndexExists(table, indexName)) return;
  if (await indexExists(table, indexName)) {
    await q(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
  }
  await q(`CREATE UNIQUE INDEX \`${indexName}\` ON \`${table}\` (${columnsSql})`);
};

const addFk = async (spec: FkSpec) => {
  if (await fkExists(spec.name)) return;
  if (await fkExistsOnColumn(spec.table, spec.column)) return;
  await ensureChildTypeMatchesParent(spec.table, spec.column, spec.refTable, spec.refColumn);
  if (spec.ensureIndexName) {
    await ensureIndex(spec.table, spec.ensureIndexName, `\`${spec.column}\``);
  }
  await q(
    `ALTER TABLE \`${spec.table}\`
     ADD CONSTRAINT \`${spec.name}\`
     FOREIGN KEY (\`${spec.column}\`)
     REFERENCES \`${spec.refTable}\` (\`${spec.refColumn}\`)
     ON DELETE ${spec.onDelete}
     ON UPDATE ${spec.onUpdate}`
  );
};

const assertNoDuplicates = async (sql: string, errMsg: (row: any) => string) => {
  const [rows] = await q(sql) as any;
  if (Array.isArray(rows) && rows.length > 0) throw new Error(errMsg(rows[0]));
};

const assertNoOrphans = async (sql: string, errMsg: string) => {
  const [rows] = await q(sql) as any;
  const count = Number(rows?.[0]?.orphanCount || 0);
  if (count > 0) throw new Error(`${errMsg} (orphanCount=${count})`);
};

export const up = async (_ctx: { sequelize: typeof sequelize }) => {
  // Backorder: enforce 1 row per order_item
  if (await tableExists('backorders')) {
    await assertNoDuplicates(
      `SELECT order_item_id, COUNT(*) AS cnt
       FROM backorders
       GROUP BY order_item_id
       HAVING COUNT(*) > 1
       LIMIT 1`,
      (r) => `Cannot add unique index on backorders.order_item_id: duplicates detected for order_item_id=${String(r.order_item_id)}. Please dedupe first.`
    );
    if (await tableExists('order_items')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM backorders b
         LEFT JOIN order_items oi ON oi.id = b.order_item_id
         WHERE b.order_item_id IS NOT NULL AND oi.id IS NULL`,
        'Cannot add FK backorders.order_item_id -> order_items.id: orphan rows detected'
      );
    }
    await ensureUniqueIndex('backorders', 'uq_backorders_order_item_id', '`order_item_id`');
    await addFk({
      name: 'fk_backorders_order_item',
      table: 'backorders',
      column: 'order_item_id',
      refTable: 'order_items',
      refColumn: 'id',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      ensureIndexName: 'idx_backorders_order_item_id',
    });
  }

  // COD collections: enforce 1 row per invoice
  if (await tableExists('cod_collections')) {
    await assertNoDuplicates(
      `SELECT invoice_id, COUNT(*) AS cnt
       FROM cod_collections
       GROUP BY invoice_id
       HAVING COUNT(*) > 1
       LIMIT 1`,
      (r) => `Cannot add unique index on cod_collections.invoice_id: duplicates detected for invoice_id=${String(r.invoice_id)}. Please dedupe first.`
    );
    if (await tableExists('invoices')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM cod_collections c
         LEFT JOIN invoices i ON i.id = c.invoice_id
         WHERE c.invoice_id IS NOT NULL AND i.id IS NULL`,
        'Cannot add FK cod_collections.invoice_id -> invoices.id: orphan rows detected'
      );
    }
    if (await tableExists('users')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM cod_collections c
         LEFT JOIN users u ON u.id = c.driver_id
         WHERE c.driver_id IS NOT NULL AND u.id IS NULL`,
        'Cannot add FK cod_collections.driver_id -> users.id: orphan rows detected'
      );
    }
    if (await tableExists('cod_settlements')) {
      await assertNoOrphans(
        `SELECT COUNT(*) AS orphanCount
         FROM cod_collections c
         LEFT JOIN cod_settlements s ON s.id = c.settlement_id
         WHERE c.settlement_id IS NOT NULL AND s.id IS NULL`,
        'Cannot add FK cod_collections.settlement_id -> cod_settlements.id: orphan rows detected'
      );
    }

    await ensureUniqueIndex('cod_collections', 'uq_cod_collections_invoice_id', '`invoice_id`');
    await ensureIndex('cod_collections', 'idx_cod_collections_driver_status', '`driver_id`, `status`');
    await ensureIndex('cod_collections', 'idx_cod_collections_settlement_id', '`settlement_id`');

    await addFk({
      name: 'fk_cod_collections_invoice',
      table: 'cod_collections',
      column: 'invoice_id',
      refTable: 'invoices',
      refColumn: 'id',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      ensureIndexName: 'idx_cod_collections_invoice_id',
    });
    await addFk({
      name: 'fk_cod_collections_driver',
      table: 'cod_collections',
      column: 'driver_id',
      refTable: 'users',
      refColumn: 'id',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      ensureIndexName: 'idx_cod_collections_driver_id',
    });
    await addFk({
      name: 'fk_cod_collections_settlement',
      table: 'cod_collections',
      column: 'settlement_id',
      refTable: 'cod_settlements',
      refColumn: 'id',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      ensureIndexName: 'idx_cod_collections_settlement_id',
    });
  }

  // Product cost state: enforce FK product_id -> products.id
  if (await tableExists('product_cost_states') && await tableExists('products')) {
    await assertNoOrphans(
      `SELECT COUNT(*) AS orphanCount
       FROM product_cost_states pcs
       LEFT JOIN products p ON p.id = pcs.product_id
       WHERE pcs.product_id IS NOT NULL AND p.id IS NULL`,
      'Cannot add FK product_cost_states.product_id -> products.id: orphan rows detected'
    );
    await addFk({
      name: 'fk_product_cost_states_product',
      table: 'product_cost_states',
      column: 'product_id',
      refTable: 'products',
      refColumn: 'id',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      ensureIndexName: 'idx_product_cost_states_product_id',
    });
  }
};

export const down = async (_ctx: { sequelize: typeof sequelize }) => {
  const names = [
    'fk_backorders_order_item',
    'fk_cod_collections_invoice',
    'fk_cod_collections_driver',
    'fk_cod_collections_settlement',
    'fk_product_cost_states_product',
  ];

  for (const name of names) {
    const [ownerRows] = await q(
      `SELECT TABLE_NAME AS tableName
       FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE()
         AND CONSTRAINT_NAME = :name
         AND CONSTRAINT_TYPE = 'FOREIGN KEY'
       LIMIT 1`,
      { name }
    ) as any;
    const tableName = ownerRows?.[0]?.tableName ? String(ownerRows[0].tableName) : '';
    if (!tableName) continue;
    await q(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${name}\``);
  }
};

