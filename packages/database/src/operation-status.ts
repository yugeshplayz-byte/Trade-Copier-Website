import { NotFoundError } from './errors.ts';
import type { Tx } from './tenant.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OperationStatus {
  readonly id: string;
  readonly kind: string;
  readonly status: 'ACCEPTED' | 'SUCCEEDED' | 'FAILED';
  readonly result: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Status of one operation, visible only within its tenant (row-level security). */
export async function getOperationStatus(tx: Tx, operationId: string): Promise<OperationStatus> {
  if (!UUID.test(operationId)) throw new NotFoundError('operation not found');
  const { rows } = await tx.query<{
    id: string;
    kind: string;
    status: OperationStatus['status'];
    result: unknown;
    created_at: Date;
    updated_at: Date;
  }>('SELECT id, kind, status, result, created_at, updated_at FROM app.operations WHERE id = $1', [operationId]);
  const row = rows[0];
  if (!row) throw new NotFoundError('operation not found');
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    result: row.result,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
