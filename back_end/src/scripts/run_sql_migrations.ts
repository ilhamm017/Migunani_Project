import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { loadEnv } from '../config/env';

type MigrationRow = {
  filename: string;
  checksum: string;
  applied_at: string;
};

const MIGRATION_TABLE = 'manual_sql_migrations';

const sha256 = (input: string) => crypto.createHash('sha256').update(input).digest('hex');

const resolveSqlDir = () => {
  const candidates = [
    path.resolve(process.cwd(), 'sql'),
    path.resolve(process.cwd(), 'back_end', 'sql'),
    path.resolve(process.cwd(), '..', 'sql'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  throw new Error(`SQL directory not found. Tried: ${candidates.join(', ')}`);
};

const isSqlFile = (filename: string) => filename.toLowerCase().endsWith('.sql');

const shouldSkipFile = (filename: string, contents: string) => {
  const base = path.basename(filename).toLowerCase();
  if (base.includes('readme')) return true;
  if (base.includes('repoint_')) return true;
  if (contents.includes('MANUAL_ONLY')) return true;
  return false;
};

const ensureMigrationTable = async (conn: mysql.Connection) => {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS \`${MIGRATION_TABLE}\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`filename\` VARCHAR(255) NOT NULL,
      \`checksum\` CHAR(64) NOT NULL,
      \`applied_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_${MIGRATION_TABLE}_filename\` (\`filename\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
  );
};

const loadAppliedMigrations = async (conn: mysql.Connection) => {
  const [rows] = await conn.query(
    `SELECT filename, checksum, applied_at FROM \`${MIGRATION_TABLE}\` ORDER BY id ASC`
  );
  const map = new Map<string, MigrationRow>();
  (rows as any[]).forEach((row) => {
    map.set(String(row.filename), {
      filename: String(row.filename),
      checksum: String(row.checksum),
      applied_at: String(row.applied_at),
    });
  });
  return map;
};

export const runSqlMigrations = async () => {
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

  try {
    await ensureMigrationTable(conn);
    const applied = await loadAppliedMigrations(conn);

    const sqlDir = resolveSqlDir();
    const allFiles = fs.readdirSync(sqlDir).filter(isSqlFile).sort();

    let appliedNow = 0;
    for (const filename of allFiles) {
      const filePath = path.join(sqlDir, filename);
      const contents = fs.readFileSync(filePath, 'utf8');
      if (shouldSkipFile(filename, contents)) continue;

      const checksum = sha256(contents);
      const existing = applied.get(filename);
      if (existing) {
        if (existing.checksum !== checksum) {
          throw new Error(
            `Migration checksum mismatch for '${filename}'. Applied checksum=${existing.checksum}, current checksum=${checksum}.`
          );
        }
        continue;
      }

      process.stdout.write(`[migrate:sql] Applying ${filename}... `);
      await conn.query(contents);
      await conn.query(`INSERT INTO \`${MIGRATION_TABLE}\` (filename, checksum) VALUES (?, ?)`, [
        filename,
        checksum,
      ]);
      appliedNow += 1;
      process.stdout.write('OK\n');
    }

    console.log(`[migrate:sql] Done. Applied ${appliedNow} new migration(s).`);
  } finally {
    await conn.end();
  }
};

if (require.main === module) {
  runSqlMigrations().catch((error) => {
    console.error('[migrate:sql] Failed:', error);
    process.exitCode = 1;
  });
}
