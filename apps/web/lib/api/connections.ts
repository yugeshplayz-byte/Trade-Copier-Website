import { z } from 'zod';
import { PROVIDER_IDS, getProvider } from '@tradecopier/contracts';
import { createSimulatedConnection, executeIdempotent, getConnection, listConnections, withTenant } from '@tradecopier/database';
import { assertSameOrigin, readJsonBody, requireIdempotencyKey } from './guards.ts';
import { ApiError, handle, json } from './http.ts';
import { requirePrincipal, type ApiDeps } from './risk-profiles.ts';

const createBody = z.object({ provider: z.enum(PROVIDER_IDS), label: z.string().trim().min(1).max(80) }).strict();

/** /api/v1/connections handlers. The execution worker establishes connections; the API only records requests. */
export function createConnectionsApi(deps: ApiDeps) {
  return {
    list: (request: Request) =>
      handle(async () => {
        const principal = await requirePrincipal(deps, request);
        const items = await withTenant(await deps.pool(), principal, (tx) => listConnections(tx));
        return json({ items, environment: 'SIMULATED', asOf: new Date().toISOString() });
      }),

    create: (request: Request) =>
      handle(async () => {
        assertSameOrigin(request, deps.allowedOrigins);
        const principal = await requirePrincipal(deps, request);
        const idempotencyKey = requireIdempotencyKey(request);
        const body = await readJsonBody(request, createBody);
        if (body.provider !== 'simulated') {
          const provider = getProvider(body.provider);
          throw new ApiError(422, 'provider_not_approved', `${provider.name} is not approved for this service.`, {
            providerStatus: provider.status,
            reason: provider.summary,
          });
        }
        const outcome = await executeIdempotent(
          await deps.pool(),
          principal,
          { idempotencyKey, kind: 'connection.create', payload: body },
          (tx) => createSimulatedConnection(tx, principal, body.label),
        );
        // Accepted, not established: the worker connects and snapshots asynchronously.
        return json({ operationId: outcome.operationId, replayed: outcome.replayed, connection: outcome.result }, 202);
      }),

    get: (request: Request, connectionId: string) =>
      handle(async () => {
        const principal = await requirePrincipal(deps, request);
        const connection = await withTenant(await deps.pool(), principal, (tx) => getConnection(tx, connectionId));
        return json({ connection, asOf: new Date().toISOString() });
      }),
  };
}
