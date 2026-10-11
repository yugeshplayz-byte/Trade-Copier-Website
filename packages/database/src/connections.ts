import type { ConnectionState, Position } from '@tradecopier/contracts';
import { NotFoundError } from './errors.ts';
import type { Pool } from './pool.ts';
import type { TenantContext, Tx, UserContext } from './tenant.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BrokerAccountView {
  readonly id: string;
  readonly providerAccountId: string;
  readonly canonicalAccountId: string;
  readonly accountClass: 'SIMULATED';
  readonly displayName: string;
  readonly positions: readonly { readonly product: string; readonly expiry: string; readonly netQuantity: number }[];
  readonly openOrders: number;
  readonly snapshotCursor: string | null;
  readonly snapshotAsOf: string | null;
}

export interface ConnectionView {
  readonly id: string;
  readonly provider: 'simulated';
  readonly environment: 'SIMULATED';
  readonly label: string;
  readonly state: ConnectionState;
  readonly stateReason: string | null;
  readonly lastSnapshotAt: string | null;
  readonly createdAt: string;
  readonly accounts: readonly BrokerAccountView[];
}

interface ConnectionRow {
  id: string;
  provider: 'simulated';
  environment: 'SIMULATED';
  label: string;
  state: ConnectionState;
  state_reason: string | null;
  last_snapshot_at: Date | null;
  created_at: Date;
}

interface AccountRow {
  id: string;
  connection_id: string;
  provider_account_id: string;
  canonical_account_id: string;
  account_class: 'SIMULATED';
  display_name: string;
  positions: BrokerAccountView['positions'];
  open_orders: number;
  snapshot_cursor: string | null;
  snapshot_as_of: Date | null;
}

function toAccount(r: AccountRow): BrokerAccountView {
  return {
    id: r.id,
    providerAccountId: r.provider_account_id,
    canonicalAccountId: r.canonical_account_id,
    accountClass: r.account_class,
    displayName: r.display_name,
    positions: r.positions,
    openOrders: r.open_orders,
    snapshotCursor: r.snapshot_cursor,
    snapshotAsOf: r.snapshot_as_of?.toISOString() ?? null,
  };
}

function toConnection(r: ConnectionRow, accounts: BrokerAccountView[]): ConnectionView {
  return {
    id: r.id,
    provider: r.provider,
    environment: r.environment,
    label: r.label,
    state: r.state,
    stateReason: r.state_reason,
    lastSnapshotAt: r.last_snapshot_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    accounts,
  };
}

/** Records a simulated connection; the execution worker establishes it. */
export async function createSimulatedConnection(tx: Tx, ctx: UserContext, label: string): Promise<{ id: string; state: ConnectionState }> {
  if (label.length < 1 || label.length > 80) throw new RangeError('label must be 1-80 characters');
  const { rows } = await tx.query<{ id: string; state: ConnectionState }>(
    `INSERT INTO app.broker_connections (tenant_id, provider, environment, label, created_by)
     VALUES ($1, 'simulated', 'SIMULATED', $2, $3) RETURNING id, state`,
    [ctx.tenantId, label, ctx.userId],
  );
  return rows[0]!;
}

/** Connections and their discovered accounts visible to the current tenant. */
export async function listConnections(tx: Tx): Promise<ConnectionView[]> {
  const connections = await tx.query<ConnectionRow>(
    `SELECT id, provider, environment, label, state, state_reason, last_snapshot_at, created_at
       FROM app.broker_connections ORDER BY created_at, id LIMIT 100`,
  );
  const accounts = await tx.query<AccountRow>(
    `SELECT id, connection_id, provider_account_id, canonical_account_id, account_class, display_name,
            positions, open_orders, snapshot_cursor, snapshot_as_of
       FROM app.broker_accounts ORDER BY provider_account_id`,
  );
  return connections.rows.map((c) =>
    toConnection(
      c,
      accounts.rows.filter((a) => a.connection_id === c.id).map(toAccount),
    ),
  );
}

export async function getConnection(tx: Tx, connectionId: string): Promise<ConnectionView> {
  if (!UUID.test(connectionId)) throw new NotFoundError('connection not found');
  const all = await listConnections(tx);
  const found = all.find((c) => c.id === connectionId);
  if (!found) throw new NotFoundError('connection not found');
  return found;
}

/* ---------------- Worker side ---------------- */

export interface ClaimedConnection extends TenantContext {
  readonly connectionId: string;
  readonly provider: string;
  readonly environment: string;
}

/** Claims connections waiting to be (re)established. Concurrent callers get disjoint work. */
export async function claimConnectionWork(pool: Pool, limit: number): Promise<ClaimedConnection[]> {
  const { rows } = await pool.query<{ out_connection_id: string; out_tenant_id: string; out_provider: string; out_environment: string }>(
    'SELECT out_connection_id, out_tenant_id, out_provider, out_environment FROM app.claim_connection_work($1)',
    [limit],
  );
  return rows.map((r) => ({
    connectionId: r.out_connection_id,
    tenantId: r.out_tenant_id,
    userId: null,
    provider: r.out_provider,
    environment: r.out_environment,
  }));
}

/** After a worker restart, marks every previously live connection for re-establishment. */
export async function markConnectionsForReconnect(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>('SELECT app.mark_connections_for_reconnect() AS n');
  return rows[0]?.n ?? 0;
}

export async function setConnectionState(
  tx: Tx,
  connectionId: string,
  state: ConnectionState,
  reason: string | null,
  snapshotAt?: Date,
): Promise<void> {
  const { rowCount } = await tx.query(
    `UPDATE app.broker_connections
        SET state = $2, state_reason = $3, updated_at = now(),
            last_snapshot_at = coalesce($4, last_snapshot_at)
      WHERE id = $1`,
    [connectionId, state, reason?.slice(0, 300) ?? null, snapshotAt ?? null],
  );
  if (rowCount !== 1) throw new NotFoundError('connection not found');
}

export interface DiscoveredAccount {
  readonly providerAccountId: string;
  readonly canonicalAccountId: string;
  readonly displayName: string;
  readonly positions: readonly Position[];
  readonly openOrders: number;
  readonly snapshotCursor: string;
  readonly snapshotAsOf: string;
}

/** Records discovered accounts and their latest snapshot projection, idempotently per connection. */
export async function recordDiscoveredAccounts(
  tx: Tx,
  ctx: TenantContext,
  connectionId: string,
  accounts: readonly DiscoveredAccount[],
): Promise<void> {
  for (const a of accounts) {
    const positions = a.positions.map((p) => ({ product: p.instrument.product, expiry: p.instrument.expiry, netQuantity: p.netQuantity }));
    await tx.query(
      `INSERT INTO app.broker_accounts
         (tenant_id, connection_id, provider, environment, provider_account_id, canonical_account_id,
          account_class, display_name, positions, open_orders, snapshot_cursor, snapshot_as_of)
       VALUES ($1, $2, 'simulated', 'SIMULATED', $3, $4, 'SIMULATED', $5, $6, $7, $8, $9)
       ON CONFLICT (connection_id, provider_account_id) DO UPDATE
         SET positions = EXCLUDED.positions, open_orders = EXCLUDED.open_orders,
             snapshot_cursor = EXCLUDED.snapshot_cursor, snapshot_as_of = EXCLUDED.snapshot_as_of`,
      [
        ctx.tenantId,
        connectionId,
        a.providerAccountId,
        a.canonicalAccountId,
        a.displayName.slice(0, 100),
        JSON.stringify(positions),
        a.openOrders,
        a.snapshotCursor,
        a.snapshotAsOf,
      ],
    );
  }
}
