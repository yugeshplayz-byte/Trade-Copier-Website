import { getOperationStatus, withTenant } from '@tradecopier/database';
import { handle, json } from './http.ts';
import { requirePrincipal, type ApiDeps } from './risk-profiles.ts';

/** /api/v1/operations handlers: the status of a request the caller's tenant made. */
export function createOperationsApi(deps: ApiDeps) {
  return {
    get: (request: Request, operationId: string) =>
      handle(async () => {
        const principal = await requirePrincipal(deps, request);
        const operation = await withTenant(await deps.pool(), principal, (tx) => getOperationStatus(tx, operationId));
        return json({ operation, asOf: new Date().toISOString() });
      }),
  };
}
