import { sequelize } from '../models';

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

const getColumnType = async (table: string, column: string) => {
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
  const parent = await getColumnType(parentTable, parentColumn);
  const child = await getColumnType(childTable, childColumn);
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

const addFk = async (spec: {
  name: string;
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
  onDelete: 'RESTRICT' | 'SET NULL' | 'CASCADE';
  onUpdate: 'CASCADE' | 'RESTRICT';
  ensureIndexName?: string;
}) => {
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

const ensureNoDuplicateCarts = async () => {
  const [rows] = await q(
    `SELECT user_id, COUNT(*) AS cnt
     FROM carts
     GROUP BY user_id
     HAVING COUNT(*) > 1
     LIMIT 1`
  ) as any;
  if (Array.isArray(rows) && rows.length > 0) {
    throw new Error(
      `Cannot add unique index on carts.user_id: duplicate carts detected for user_id=${String(rows[0].user_id)}. ` +
      `Please dedupe carts first.`
    );
  }
};

const ensureNoDuplicateCartItems = async () => {
  const [rows] = await q(
    `SELECT cart_id, product_id, COUNT(*) AS cnt
     FROM cart_items
     GROUP BY cart_id, product_id
     HAVING COUNT(*) > 1
     LIMIT 1`
  ) as any;
  if (Array.isArray(rows) && rows.length > 0) {
    throw new Error(
      `Cannot add unique index on cart_items(cart_id, product_id): duplicates detected for cart_id=${String(rows[0].cart_id)} product_id=${String(rows[0].product_id)}. ` +
      `Please dedupe cart_items first.`
    );
  }
};

export const up = async (_ctx: { sequelize: typeof sequelize }) => {
  if (!(await tableExists('carts')) || !(await tableExists('cart_items'))) return;

  await ensureNoDuplicateCarts();
  await ensureNoDuplicateCartItems();

  await ensureUniqueIndex('carts', 'uq_carts_user_id', '`user_id`');
  await ensureIndex('cart_items', 'idx_cart_items_cart_id', '`cart_id`');
  await ensureIndex('cart_items', 'idx_cart_items_product_id', '`product_id`');
  await ensureUniqueIndex('cart_items', 'uq_cart_items_cart_id_product_id', '`cart_id`, `product_id`');

  await addFk({
    name: 'fk_carts_user',
    table: 'carts',
    column: 'user_id',
    refTable: 'users',
    refColumn: 'id',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  await addFk({
    name: 'fk_cart_items_cart',
    table: 'cart_items',
    column: 'cart_id',
    refTable: 'carts',
    refColumn: 'id',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    ensureIndexName: 'idx_cart_items_cart_id',
  });

  await addFk({
    name: 'fk_cart_items_product',
    table: 'cart_items',
    column: 'product_id',
    refTable: 'products',
    refColumn: 'id',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    ensureIndexName: 'idx_cart_items_product_id',
  });
};

export const down = async (_ctx: { sequelize: typeof sequelize }) => {
  const fks = ['fk_carts_user', 'fk_cart_items_cart', 'fk_cart_items_product'];
  for (const name of fks) {
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
