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

const indexExistsOnColumn = async (table: string, column: string) => {
    const [rows] = await q(
        `SELECT 1 AS ok
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table
           AND COLUMN_NAME = :column
         LIMIT 1`,
        { table, column }
    ) as any;
    return Array.isArray(rows) && rows.length > 0;
};

const ensureIndex = async (table: string, indexName: string, columnsSql: string) => {
    const anyIndexOnColumn = columnsSql.match(/`([^`]+)`/)?.[1];
    if (anyIndexOnColumn) {
        const hasAny = await indexExistsOnColumn(table, anyIndexOnColumn);
        if (hasAny) return;
    }
    const existsByName = await indexExists(table, indexName);
    if (existsByName) return;
    await q(`CREATE INDEX \`${indexName}\` ON \`${table}\` (${columnsSql})`);
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

export const up = async (_ctx: { sequelize: typeof sequelize }) => {
    // Wave A: add core FK constraints + indexes.
    // Policy: conservative (RESTRICT default). Use SET NULL only for nullable/optional links.
    const fks: FkSpec[] = [
        { name: 'fk_orders_customer', table: 'orders', column: 'customer_id', refTable: 'users', refColumn: 'id', onDelete: 'SET NULL', onUpdate: 'CASCADE', ensureIndexName: 'idx_orders_customer_id' },
        { name: 'fk_orders_courier', table: 'orders', column: 'courier_id', refTable: 'users', refColumn: 'id', onDelete: 'SET NULL', onUpdate: 'CASCADE', ensureIndexName: 'idx_orders_courier_id' },
        { name: 'fk_order_items_order', table: 'order_items', column: 'order_id', refTable: 'orders', refColumn: 'id', onDelete: 'RESTRICT', onUpdate: 'CASCADE', ensureIndexName: 'idx_order_items_order_id' },
        { name: 'fk_order_items_product', table: 'order_items', column: 'product_id', refTable: 'products', refColumn: 'id', onDelete: 'RESTRICT', onUpdate: 'CASCADE', ensureIndexName: 'idx_order_items_product_id' },
        { name: 'fk_invoices_order', table: 'invoices', column: 'order_id', refTable: 'orders', refColumn: 'id', onDelete: 'SET NULL', onUpdate: 'CASCADE', ensureIndexName: 'idx_invoices_order_id' },
        { name: 'fk_invoices_customer', table: 'invoices', column: 'customer_id', refTable: 'users', refColumn: 'id', onDelete: 'SET NULL', onUpdate: 'CASCADE', ensureIndexName: 'idx_invoices_customer_id' },
        { name: 'fk_invoices_courier', table: 'invoices', column: 'courier_id', refTable: 'users', refColumn: 'id', onDelete: 'SET NULL', onUpdate: 'CASCADE', ensureIndexName: 'idx_invoices_courier_id' },
        { name: 'fk_invoices_verified_by', table: 'invoices', column: 'verified_by', refTable: 'users', refColumn: 'id', onDelete: 'SET NULL', onUpdate: 'CASCADE', ensureIndexName: 'idx_invoices_verified_by' },
        { name: 'fk_invoice_items_invoice', table: 'invoice_items', column: 'invoice_id', refTable: 'invoices', refColumn: 'id', onDelete: 'RESTRICT', onUpdate: 'CASCADE', ensureIndexName: 'idx_invoice_items_invoice_id' },
        { name: 'fk_invoice_items_order_item', table: 'invoice_items', column: 'order_item_id', refTable: 'order_items', refColumn: 'id', onDelete: 'RESTRICT', onUpdate: 'CASCADE', ensureIndexName: 'idx_invoice_items_order_item_id' },
        { name: 'fk_returs_order', table: 'returs', column: 'order_id', refTable: 'orders', refColumn: 'id', onDelete: 'RESTRICT', onUpdate: 'CASCADE', ensureIndexName: 'idx_returs_order_id' },
        { name: 'fk_returs_invoice', table: 'returs', column: 'invoice_id', refTable: 'invoices', refColumn: 'id', onDelete: 'SET NULL', onUpdate: 'CASCADE', ensureIndexName: 'idx_returs_invoice_id' },
        { name: 'fk_returs_product', table: 'returs', column: 'product_id', refTable: 'products', refColumn: 'id', onDelete: 'RESTRICT', onUpdate: 'CASCADE', ensureIndexName: 'idx_returs_product_id' },
        { name: 'fk_returs_created_by', table: 'returs', column: 'created_by', refTable: 'users', refColumn: 'id', onDelete: 'RESTRICT', onUpdate: 'CASCADE', ensureIndexName: 'idx_returs_created_by' },
        { name: 'fk_returs_courier', table: 'returs', column: 'courier_id', refTable: 'users', refColumn: 'id', onDelete: 'SET NULL', onUpdate: 'CASCADE', ensureIndexName: 'idx_returs_courier_id' },
        { name: 'fk_retur_handovers_invoice', table: 'retur_handovers', column: 'invoice_id', refTable: 'invoices', refColumn: 'id', onDelete: 'RESTRICT', onUpdate: 'CASCADE', ensureIndexName: 'idx_retur_handovers_invoice_id' },
        { name: 'fk_retur_handovers_driver', table: 'retur_handovers', column: 'driver_id', refTable: 'users', refColumn: 'id', onDelete: 'RESTRICT', onUpdate: 'CASCADE', ensureIndexName: 'idx_retur_handovers_driver_id' },
        { name: 'fk_retur_handovers_received_by', table: 'retur_handovers', column: 'received_by', refTable: 'users', refColumn: 'id', onDelete: 'SET NULL', onUpdate: 'CASCADE', ensureIndexName: 'idx_retur_handovers_received_by' },
        { name: 'fk_retur_handover_items_handover', table: 'retur_handover_items', column: 'handover_id', refTable: 'retur_handovers', refColumn: 'id', onDelete: 'RESTRICT', onUpdate: 'CASCADE', ensureIndexName: 'idx_retur_handover_items_handover_id' },
        { name: 'fk_retur_handover_items_retur', table: 'retur_handover_items', column: 'retur_id', refTable: 'returs', refColumn: 'id', onDelete: 'RESTRICT', onUpdate: 'CASCADE', ensureIndexName: 'idx_retur_handover_items_retur_id' },
    ];

    for (const spec of fks) {
        await addFk(spec);
    }
};

export const down = async (_ctx: { sequelize: typeof sequelize }) => {
    // Conservative rollback: drop constraints only (leave indexes in place).
    const names = [
        'fk_orders_customer',
        'fk_orders_courier',
        'fk_order_items_order',
        'fk_order_items_product',
        'fk_invoices_order',
        'fk_invoices_customer',
        'fk_invoices_courier',
        'fk_invoices_verified_by',
        'fk_invoice_items_invoice',
        'fk_invoice_items_order_item',
        'fk_returs_order',
        'fk_returs_invoice',
        'fk_returs_product',
        'fk_returs_created_by',
        'fk_returs_courier',
        'fk_retur_handovers_invoice',
        'fk_retur_handovers_driver',
        'fk_retur_handovers_received_by',
        'fk_retur_handover_items_handover',
        'fk_retur_handover_items_retur',
    ];
    for (const name of names) {
        await q(
            `SELECT CONSTRAINT_NAME AS name
             FROM information_schema.TABLE_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = DATABASE()
               AND CONSTRAINT_NAME = :name
               AND CONSTRAINT_TYPE = 'FOREIGN KEY'
             LIMIT 1`,
            { name }
        ).then(async ([rows]: any) => {
            if (!Array.isArray(rows) || rows.length === 0) return;
            // Find owning table
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
            if (!tableName) return;
            await q(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${name}\``);
        });
    }
};
