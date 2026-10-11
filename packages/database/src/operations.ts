import { createHash } from 'node:crypto';
import { IdempotencyConflictError } from './errors.ts';
import type { Pool } from './pool.ts';
import { withTenant, type Tx, type UserContext } from './tenant.ts';

export interface OperationRequest {
  /** Client-supplied Idempotency-Key header value. */
  readonly idempotencyKey: string;
  readonly kind: string;
  /** Validated request payload; hashed to detect key reuse with a different body. */
  readonly payload: unknown;
}

export interface OperationOutcome<T> {
  readonly operationId: string;
  readonly result: T;
  /** True when an earlier identical request already produced this result. */
  readonly replayed: boolean;
}

/** Deterministic JSON with sorted object keys. Rejects values JSON cannot represent. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number in payload');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new TypeError(`unsupported value in payload: ${typeof value}`);
}

export function requestHash(kind: string, payload: unknown): string {
  return createHash('sha256').update(`${kind}\n${canonicalJson(payload)}`).digest('hex');
}

/**
 * Executes a mutation at most once per (tenant, idempotency key). The operation
 * row, the handler's writes and the audit record commit in one transaction.
 * Repeating the same request returns the stored result without re-running the
 * handler; reusing the key with a different request throws a conflict (409).
 * If the handler throws, nothing is recorded and the request can be retried.
 */
export async function executeIdempotent<T>(
  pool: Pool,
  ctx: UserContext,
  request: OperationRequest,
  handler: (tx: Tx, operationId: string) => Promise<T>,
): Promise<OperationOutcome<T>> {
  if (request.idempotencyKey.length < 8 || request.idempotencyKey.length > 200) {
    throw new RangeError('idempotency key must be 8-200 characters');
  }
  const hash = requestHash(request.kind, request.payload);

  return withTenant(pool, ctx, async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO app.operations (tenant_id, actor_user_id, idempotency_key, request_hash, kind, status)
       VALUES ($1, $2, $3, $4, $5, 'ACCEPTED')
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [ctx.tenantId, ctx.userId, request.idempotencyKey, hash, request.kind],
    );

    const newId = inserted.rows[0]?.id;
    if (newId === undefined) {
      const existing = await tx.query<{ id: string; request_hash: string; result: T }>(
        'SELECT id, request_hash, result FROM app.operations WHERE idempotency_key = $1',
        [request.idempotencyKey],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('idempotency record vanished');
      if (row.request_hash !== hash) {
        throw new IdempotencyConflictError('idempotency key was already used for a different request');
      }
      return { operationId: row.id, result: row.result, replayed: true };
    }

    const result = await handler(tx, newId);
    await tx.query(`UPDATE app.operations SET status = 'SUCCEEDED', result = $2, updated_at = now() WHERE id = $1`, [
      newId,
      JSON.stringify(result ?? null),
    ]);
    await tx.query(
      `INSERT INTO app.audit_logs (tenant_id, actor_user_id, action, operation_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [ctx.tenantId, ctx.userId, request.kind, newId, JSON.stringify({ requestHash: hash })],
    );
    return { operationId: newId, result, replayed: false };
  });
}
