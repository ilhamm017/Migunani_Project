import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { loadEnv } from '../config/env';

type RelationSpec = {
    name: string;
    child: { table: string; column: string };
    parent: { table: string; column: string };
};

type ColumnInfo = {
    table: string;
    column: string;
    columnType: string | null;
    dataType: string | null;
    charset: string | null;
    collation: string | null;
    isNullable: boolean | null;
};

type IndexInfo = {
    indexName: string;
    seqInIndex: number;
    nonUnique: boolean;
    columnName: string;
};

type AuditRow = {
    relation: RelationSpec;
    childColumn: ColumnInfo;
    parentColumn: ColumnInfo;
    orphanCount: number;
    orphanExamples: string[];
    childIndexes: IndexInfo[];
    existingForeignKeys: Array<{
        constraintName: string;
        referencedTable: string;
        referencedColumn: string;
        deleteRule: string;
        updateRule: string;
    }>;
    notes: string[];
};

const parseArgs = () => {
    const args = process.argv.slice(2);
    const outArg = args.find((a) => a.startsWith('--out='));
    const outPath = outArg ? outArg.slice('--out='.length) : '';
    return {
        outPath: outPath.trim() || '',
    };
};

const toBoolNullable = (raw: unknown): boolean | null => {
    if (raw === null || raw === undefined) return null;
    const v = String(raw).trim().toUpperCase();
    if (v === 'YES') return true;
    if (v === 'NO') return false;
    return null;
};

const main = async () => {
    loadEnv();
    const { outPath } = parseArgs();

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

    const rels: RelationSpec[] = [
        { name: 'orders.customer_id -> users.id', child: { table: 'orders', column: 'customer_id' }, parent: { table: 'users', column: 'id' } },
        { name: 'orders.courier_id -> users.id', child: { table: 'orders', column: 'courier_id' }, parent: { table: 'users', column: 'id' } },
        { name: 'order_items.order_id -> orders.id', child: { table: 'order_items', column: 'order_id' }, parent: { table: 'orders', column: 'id' } },
        { name: 'order_items.product_id -> products.id', child: { table: 'order_items', column: 'product_id' }, parent: { table: 'products', column: 'id' } },
        { name: 'invoices.order_id -> orders.id', child: { table: 'invoices', column: 'order_id' }, parent: { table: 'orders', column: 'id' } },
        { name: 'invoices.customer_id -> users.id', child: { table: 'invoices', column: 'customer_id' }, parent: { table: 'users', column: 'id' } },
        { name: 'invoices.courier_id -> users.id', child: { table: 'invoices', column: 'courier_id' }, parent: { table: 'users', column: 'id' } },
        { name: 'invoices.verified_by -> users.id', child: { table: 'invoices', column: 'verified_by' }, parent: { table: 'users', column: 'id' } },
        { name: 'invoice_items.invoice_id -> invoices.id', child: { table: 'invoice_items', column: 'invoice_id' }, parent: { table: 'invoices', column: 'id' } },
        { name: 'invoice_items.order_item_id -> order_items.id', child: { table: 'invoice_items', column: 'order_item_id' }, parent: { table: 'order_items', column: 'id' } },
        { name: 'returs.order_id -> orders.id', child: { table: 'returs', column: 'order_id' }, parent: { table: 'orders', column: 'id' } },
        { name: 'returs.invoice_id -> invoices.id', child: { table: 'returs', column: 'invoice_id' }, parent: { table: 'invoices', column: 'id' } },
        { name: 'returs.product_id -> products.id', child: { table: 'returs', column: 'product_id' }, parent: { table: 'products', column: 'id' } },
        { name: 'returs.created_by -> users.id', child: { table: 'returs', column: 'created_by' }, parent: { table: 'users', column: 'id' } },
        { name: 'returs.courier_id -> users.id', child: { table: 'returs', column: 'courier_id' }, parent: { table: 'users', column: 'id' } },
        { name: 'retur_handovers.invoice_id -> invoices.id', child: { table: 'retur_handovers', column: 'invoice_id' }, parent: { table: 'invoices', column: 'id' } },
        { name: 'retur_handovers.driver_id -> users.id', child: { table: 'retur_handovers', column: 'driver_id' }, parent: { table: 'users', column: 'id' } },
        { name: 'retur_handovers.received_by -> users.id', child: { table: 'retur_handovers', column: 'received_by' }, parent: { table: 'users', column: 'id' } },
        { name: 'retur_handover_items.handover_id -> retur_handovers.id', child: { table: 'retur_handover_items', column: 'handover_id' }, parent: { table: 'retur_handovers', column: 'id' } },
        { name: 'retur_handover_items.retur_id -> returs.id', child: { table: 'retur_handover_items', column: 'retur_id' }, parent: { table: 'returs', column: 'id' } },
    ];

    const getColumnInfo = async (table: string, column: string): Promise<ColumnInfo> => {
        const [rows] = await conn.query(
            `SELECT COLUMN_TYPE AS columnType,
                    DATA_TYPE AS dataType,
                    CHARACTER_SET_NAME AS charsetName,
                    COLLATION_NAME AS collationName,
                    IS_NULLABLE AS isNullable
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ?
               AND COLUMN_NAME = ?
             LIMIT 1`,
            [table, column]
        );
        const row = Array.isArray(rows) && rows.length > 0 ? (rows as any[])[0] : null;
        return {
            table,
            column,
            columnType: row ? String(row.columnType ?? '') : null,
            dataType: row ? String(row.dataType ?? '') : null,
            charset: row ? (row.charsetName === null ? null : String(row.charsetName)) : null,
            collation: row ? (row.collationName === null ? null : String(row.collationName)) : null,
            isNullable: row ? toBoolNullable(row.isNullable) : null,
        };
    };

    const getIndexes = async (table: string): Promise<IndexInfo[]> => {
        const [rows] = await conn.query(
            `SELECT INDEX_NAME AS indexName,
                    SEQ_IN_INDEX AS seqInIndex,
                    NON_UNIQUE AS nonUnique,
                    COLUMN_NAME AS columnName
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ?
             ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
            [table]
        );
        const out: IndexInfo[] = [];
        (rows as any[]).forEach((r) => {
            out.push({
                indexName: String(r.indexName),
                seqInIndex: Number(r.seqInIndex),
                nonUnique: Number(r.nonUnique) === 1,
                columnName: String(r.columnName),
            });
        });
        return out;
    };

    const getExistingFKs = async (table: string, column: string) => {
        const [rows] = await conn.query(
            `SELECT
                k.CONSTRAINT_NAME AS constraintName,
                k.REFERENCED_TABLE_NAME AS referencedTable,
                k.REFERENCED_COLUMN_NAME AS referencedColumn,
                r.DELETE_RULE AS deleteRule,
                r.UPDATE_RULE AS updateRule
             FROM information_schema.KEY_COLUMN_USAGE k
             JOIN information_schema.REFERENTIAL_CONSTRAINTS r
               ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
              AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
             WHERE k.CONSTRAINT_SCHEMA = DATABASE()
               AND k.TABLE_NAME = ?
               AND k.COLUMN_NAME = ?
               AND k.REFERENCED_TABLE_NAME IS NOT NULL`,
            [table, column]
        );
        return (rows as any[]).map((r) => ({
            constraintName: String(r.constraintName),
            referencedTable: String(r.referencedTable),
            referencedColumn: String(r.referencedColumn),
            deleteRule: String(r.deleteRule),
            updateRule: String(r.updateRule),
        }));
    };

    const auditOne = async (rel: RelationSpec): Promise<AuditRow> => {
        const notes: string[] = [];
        const childColumn = await getColumnInfo(rel.child.table, rel.child.column);
        const parentColumn = await getColumnInfo(rel.parent.table, rel.parent.column);

        const [countRows] = await conn.query(
            `SELECT COUNT(*) AS orphanCount
             FROM \`${rel.child.table}\` c
             LEFT JOIN \`${rel.parent.table}\` p
               ON p.\`${rel.parent.column}\` = c.\`${rel.child.column}\`
             WHERE c.\`${rel.child.column}\` IS NOT NULL
               AND p.\`${rel.parent.column}\` IS NULL`
        );
        const orphanCount = Number((countRows as any[])[0]?.orphanCount || 0);

        const [exampleRows] = await conn.query(
            `SELECT c.\`${rel.child.column}\` AS orphanId
             FROM \`${rel.child.table}\` c
             LEFT JOIN \`${rel.parent.table}\` p
               ON p.\`${rel.parent.column}\` = c.\`${rel.child.column}\`
             WHERE c.\`${rel.child.column}\` IS NOT NULL
               AND p.\`${rel.parent.column}\` IS NULL
             ORDER BY c.\`${rel.child.column}\` ASC
             LIMIT 20`
        );
        const orphanExamples = (exampleRows as any[]).map((r) => String(r.orphanId));

        const childIndexes = (await getIndexes(rel.child.table)).filter((idx) => idx.columnName === rel.child.column);
        if (childIndexes.length === 0) notes.push('No index found on child FK column (may slow FK checks / joins).');

        const existingForeignKeys = await getExistingFKs(rel.child.table, rel.child.column);
        if (existingForeignKeys.length > 0) notes.push('Existing FK constraint(s) detected (may already be enforced).');

        if (childColumn.columnType && parentColumn.columnType && childColumn.columnType !== parentColumn.columnType) {
            notes.push(`Type mismatch: child=${childColumn.columnType}, parent=${parentColumn.columnType}`);
        }
        if (childColumn.collation && parentColumn.collation && childColumn.collation !== parentColumn.collation) {
            notes.push(`Collation mismatch: child=${childColumn.collation}, parent=${parentColumn.collation}`);
        }

        return {
            relation: rel,
            childColumn,
            parentColumn,
            orphanCount,
            orphanExamples,
            childIndexes,
            existingForeignKeys,
            notes,
        };
    };

    try {
        console.log('[db:fk-audit] Connecting...');
        console.log(`  - DB: ${database} @ ${host}:${port}`);

        const startedAt = Date.now();
        const results: AuditRow[] = [];
        for (const rel of rels) {
            process.stdout.write(`[db:fk-audit] ${rel.name}... `);
            try {
                const row = await auditOne(rel);
                results.push(row);
                process.stdout.write('OK\n');
            } catch (error: any) {
                process.stdout.write('FAILED\n');
                results.push({
                    relation: rel,
                    childColumn: { table: rel.child.table, column: rel.child.column, columnType: null, dataType: null, charset: null, collation: null, isNullable: null },
                    parentColumn: { table: rel.parent.table, column: rel.parent.column, columnType: null, dataType: null, charset: null, collation: null, isNullable: null },
                    orphanCount: -1,
                    orphanExamples: [],
                    childIndexes: [],
                    existingForeignKeys: [],
                    notes: [`Audit failed: ${String(error?.message || error)}`],
                });
            }
        }

        const summary = results.map((r) => ({
            name: r.relation.name,
            orphanCount: r.orphanCount,
            hasIndexOnChildCol: r.childIndexes.length > 0,
            existingFks: r.existingForeignKeys.map((fk) => fk.constraintName),
            notes: r.notes,
        }));

        console.log('[db:fk-audit] Done.', {
            relations: results.length,
            durationMs: Date.now() - startedAt,
            orphanRelations: summary.filter((s) => s.orphanCount > 0).length,
        });

        if (outPath) {
            const resolved = path.resolve(outPath);
            fs.writeFileSync(resolved, JSON.stringify({ summary, results }, null, 2), 'utf8');
            console.log(`[db:fk-audit] Wrote report: ${resolved}`);
        } else {
            console.log('[db:fk-audit] Summary:');
            summary.forEach((s) => {
                const orphanTag = s.orphanCount > 0 ? `ORPHANS=${s.orphanCount}` : 'orphan=0';
                const idxTag = s.hasIndexOnChildCol ? 'idx=ok' : 'idx=missing';
                const fkTag = s.existingFks.length > 0 ? `fk=${s.existingFks.join(',')}` : 'fk=none';
                console.log(`  - ${s.name}: ${orphanTag}, ${idxTag}, ${fkTag}`);
                if (s.notes.length > 0) console.log(`    notes: ${s.notes.join(' | ')}`);
            });
            console.log("Tip: run with `--out=/tmp/migunani_fk_audit.json` to save full details.");
        }

        process.exit(0);
    } finally {
        await conn.end();
    }
};

main().catch((error) => {
    console.error('[db:fk-audit] Failed:', error);
    process.exit(1);
});

