import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from './pool.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;
/** Arbitrary constant for pg_advisory_lock: one migration run at a time per database. */
const MIGRATION_LOCK_KEY = 7_201_337;

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrationReport {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

export class MigrationIntegrityError extends Error {
  override readonly name = 'MigrationIntegrityError';
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set<string>();
  return files.map((name) => {
    const match = MIGRATION_FILE.exec(name);
    if (!match) throw new MigrationIntegrityError(`migration file name not allowed: ${name}`);
    const version = match[1]!;
    if (seen.has(version)) throw new MigrationIntegrityError(`duplicate migration version ${version}`);
    seen.add(version);
    const sql = readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n');
    return { version, name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

/**
 * Applies pending migrations in order, each in its own transaction, under an
 * advisory lock. An applied migration whose file has changed is an integrity
 * error: migrations are append-only. Never invoked automatically at app startup.
 */
export async function migrate(pool: Pool, migrations: readonly Migration[] = loadMigrations()): Promise<MigrationReport> {
  const client = await pool.connect();
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query('CREATE SCHEMA IF NOT EXISTS meta');
    await client.query(`CREATE TABLE IF NOT EXISTS meta.schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM meta.schema_migrations',
    );
    const recorded = new Map(rows.map((r) => [r.version, r.checksum]));
    const known = new Set(migrations.map((m) => m.version));
    for (const version of recorded.keys()) {
      if (!known.has(version)) throw new MigrationIntegrityError(`database has migration ${version} that is not in the codebase`);
    }

    for (const migration of migrations) {
      const checksum = recorded.get(migration.version);
      if (checksum !== undefined) {
        if (checksum !== migration.checksum) {
          throw new MigrationIntegrityError(`applied migration ${migration.name} has been modified`);
        }
        alreadyApplied.push(migration.name);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO meta.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          migration.version,
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      applied.push(migration.name);
    }
    return { applied, alreadyApplied };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
