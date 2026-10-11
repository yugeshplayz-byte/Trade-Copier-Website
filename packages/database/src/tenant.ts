import type { Pool, PoolClient } from './pool.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Server-derived scope for one request or job. Built from the authenticated
 * session, or from a worker job claimed for a specific tenant, never from
 * client-supplied tenant IDs. `userId` is null for worker jobs that act for the
 * tenant without a signed-in user.
 */
export interface TenantContext {
  readonly tenantId: string;
  readonly userId: string | null;
}

/** A tenant context with a known acting user, required wherever an actor is recorded. */
export interface UserContext extends TenantContext {
  readonly userId: string;
}

export type Tx = PoolClient;

/**
 * Runs `fn` in one transaction with the tenant context set transaction-locally,
 * so a pooled connection can never carry one tenant's context into another
 * request. Row-level security reads this context; without it, tenant tables
 * return no rows.
 */
export async function withTenant<T>(pool: Pool, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(ctx.tenantId) || (ctx.userId !== null && !UUID.test(ctx.userId))) {
    throw new RangeError('tenant context requires UUIDs');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [
      ctx.tenantId,
      ctx.userId ?? '',
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
