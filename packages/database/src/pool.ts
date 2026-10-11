import pg from 'pg';
import { UnsafeDatabaseRoleError } from './errors.ts';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export interface PoolOptions {
  readonly connectionString: string;
  readonly applicationName: string;
  readonly max?: number;
  /** Server-side statement timeout; a hung query must not hold a connection forever. */
  readonly statementTimeoutMs?: number;
}

export function createPool(options: PoolOptions): Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.max ?? 10,
    statement_timeout: options.statementTimeoutMs ?? 5_000,
    idle_in_transaction_session_timeout: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  // Without a listener, an idle client error would crash the process with the raw error.
  pool.on('error', () => {
    /* The next checkout surfaces a fresh error; nothing else to do here. */
  });
  return pool;
}

/**
 * Verifies the pool connects as a restricted runtime role: not a superuser, not
 * able to bypass row-level security, and not the owner of any application table
 * (owners bypass RLS). Call once at startup before serving requests.
 */
export async function assertRestrictedRuntimeRole(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean; owned_tables: string }>(
    `SELECT r.rolsuper, r.rolbypassrls,
            (SELECT count(*) FROM pg_tables t WHERE t.schemaname = 'app' AND t.tableowner = current_user)::text AS owned_tables
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const role = rows[0];
  if (!role) throw new UnsafeDatabaseRoleError('could not inspect the connected role');
  if (role.rolsuper) throw new UnsafeDatabaseRoleError('runtime connection uses a superuser role');
  if (role.rolbypassrls) throw new UnsafeDatabaseRoleError('runtime connection role can bypass row-level security');
  if (role.owned_tables !== '0') throw new UnsafeDatabaseRoleError('runtime connection role owns application tables');
}
