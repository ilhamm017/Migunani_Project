import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { sequelize } from '../models';
import { loadEnv } from '../config/env';
import { acquireSchemaLock } from '../utils/schemaLock';
import { runSqlMigrations } from './run_sql_migrations';

type MigrationModule = {
    up: (ctx: { sequelize: typeof sequelize }) => Promise<void>;
    down?: (ctx: { sequelize: typeof sequelize }) => Promise<void>;
};

const MIGRATION_TABLE = 'app_migrations';

const sha256 = (input: string) => crypto.createHash('sha256').update(input).digest('hex');

const resolveMigrationsDir = () => {
    const candidates = [
        path.resolve(__dirname, '..', 'migrations'),
        path.resolve(process.cwd(), 'dist', 'migrations'),
        path.resolve(process.cwd(), 'src', 'migrations'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    }
    throw new Error(`Migrations directory not found. Tried: ${candidates.join(', ')}`);
};

const listMigrationFiles = (dir: string) => {
    const entries = fs.readdirSync(dir);
    return entries
        .filter((f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts') && !f.endsWith('.map'))
        .filter((f) => !f.toLowerCase().includes('readme'))
        .sort();
};

const ensureMigrationTable = async () => {
    await sequelize.query(
        `CREATE TABLE IF NOT EXISTS \`${MIGRATION_TABLE}\` (
          \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`name\` VARCHAR(255) NOT NULL,
          \`checksum\` CHAR(64) NOT NULL,
          \`applied_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uq_${MIGRATION_TABLE}_name\` (\`name\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
    );
};

const loadApplied = async (): Promise<Map<string, { checksum: string; appliedAt: string }>> => {
    const [rows] = await sequelize.query(
        `SELECT name, checksum, applied_at AS appliedAt FROM \`${MIGRATION_TABLE}\` ORDER BY id ASC`
    ) as any;
    const map = new Map<string, { checksum: string; appliedAt: string }>();
    (rows as any[]).forEach((row) => {
        map.set(String(row.name), { checksum: String(row.checksum), appliedAt: String(row.appliedAt) });
    });
    return map;
};

const loadModule = (filePath: string): MigrationModule => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(filePath);
    const up = mod?.up || mod?.default?.up;
    const down = mod?.down || mod?.default?.down;
    if (typeof up !== 'function') {
        throw new Error(`Migration '${path.basename(filePath)}' does not export async 'up(ctx)'`);
    }
    return { up, down };
};

const runUp = async (opts: { withSql?: boolean }) => {
    const dir = resolveMigrationsDir();
    const files = listMigrationFiles(dir);

    await ensureMigrationTable();
    const applied = await loadApplied();

    // 1) Apply bootstrap migrations first (create missing tables).
    // This ensures legacy SQL migrations that rely on base tables won't fail on fresh DBs.
    const bootstrapFiles = files.filter((f) => /^0000_/.test(f));
    const otherFiles = files.filter((f) => !/^0000_/.test(f));

    let appliedNow = 0;
    const applyOne = async (filename: string) => {
        const fullPath = path.join(dir, filename);
        const contents = fs.readFileSync(fullPath, 'utf8');
        const checksum = sha256(contents);

        const existing = applied.get(filename);
        if (existing) {
            if (existing.checksum !== checksum) {
                throw new Error(
                    `Migration checksum mismatch for '${filename}'. Applied checksum=${existing.checksum}, current checksum=${checksum}.`
                );
            }
            return;
        }

        process.stdout.write(`[migrate] Applying ${filename}... `);
        const mod = loadModule(fullPath);
        await mod.up({ sequelize });
        await sequelize.query(
            `INSERT INTO \`${MIGRATION_TABLE}\` (name, checksum) VALUES (?, ?)`,
            { replacements: [filename, checksum] }
        );
        appliedNow += 1;
        process.stdout.write('OK\n');
    };

    if (opts.withSql) {
        for (const filename of bootstrapFiles) {
            await applyOne(filename);
        }

        process.stdout.write('[migrate] Applying legacy SQL migrations (manual_sql_migrations)... ');
        await runSqlMigrations();
        process.stdout.write('OK\n');

        for (const filename of otherFiles) {
            await applyOne(filename);
        }
    } else {
        for (const filename of files) {
            await applyOne(filename);
        }
    }

    console.log(`[migrate] Done. Applied ${appliedNow} new migration(s).`);
};

const runStatus = async () => {
    const dir = resolveMigrationsDir();
    const files = listMigrationFiles(dir);
    await ensureMigrationTable();
    const applied = await loadApplied();

    const appliedList = files.filter((f) => applied.has(f));
    const pendingList = files.filter((f) => !applied.has(f));

    console.log('[migrate] Status');
    console.log(`  - Applied: ${appliedList.length}`);
    console.log(`  - Pending: ${pendingList.length}`);
    if (pendingList.length > 0) {
        pendingList.slice(0, 20).forEach((f) => console.log(`    - ${f}`));
        if (pendingList.length > 20) console.log(`    ... (+${pendingList.length - 20} more)`);
    }
};

const runDown = async () => {
    const dir = resolveMigrationsDir();
    const files = listMigrationFiles(dir);
    await ensureMigrationTable();
    const applied = await loadApplied();

    const appliedFiles = files.filter((f) => applied.has(f));
    if (appliedFiles.length === 0) {
        console.log('[migrate] No applied migrations to rollback.');
        return;
    }
    const last = appliedFiles[appliedFiles.length - 1];
    const fullPath = path.join(dir, last);
    const mod = loadModule(fullPath);
    if (typeof mod.down !== 'function') {
        throw new Error(`Migration '${last}' has no 'down(ctx)' implementation.`);
    }

    process.stdout.write(`[migrate] Rolling back ${last}... `);
    await mod.down({ sequelize });
    await sequelize.query(
        `DELETE FROM \`${MIGRATION_TABLE}\` WHERE name = ?`,
        { replacements: [last] }
    );
    process.stdout.write('OK\n');
};

const parseCommand = () => {
    const args = process.argv.slice(2).map((a) => String(a || '').trim()).filter(Boolean);
    const cmd = (args[0] || 'up').toLowerCase();
    const withSql = args.includes('--with-sql');
    return { cmd, withSql };
};

const main = async () => {
    loadEnv();

    const { cmd, withSql } = parseCommand();
    await sequelize.authenticate();

    let lock: Awaited<ReturnType<typeof acquireSchemaLock>> | null = null;
    try {
        console.log('[SchemaLock] Waiting to acquire schema lock for migrations...');
        lock = await acquireSchemaLock(sequelize);
        console.log(`[SchemaLock] Acquired '${lock.lockName}'`);

        if (cmd === 'up') {
            await runUp({ withSql });
        } else if (cmd === 'down') {
            await runDown();
        } else if (cmd === 'status') {
            await runStatus();
        } else {
            throw new Error(`Unknown command: ${cmd}. Use: up|down|status`);
        }
    } finally {
        if (lock) {
            await lock.release();
            console.log(`[SchemaLock] Released '${lock.lockName}'`);
        }
        try { await sequelize.close(); } catch { }
    }
};

main().catch((error) => {
    console.error('[migrate] Failed:', error);
    process.exit(1);
});
