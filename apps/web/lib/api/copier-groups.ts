import { z } from 'zod';
import { SIMULATED_CONTRACTS } from '@tradecopier/broker-simulated';
import {
  createCopierGroup,
  executeIdempotent,
  getCopierGroup,
  listAccountFacts,
  listCopierGroups,
  requestActivation,
  withTenant,
  type StoredGroupConfig,
} from '@tradecopier/database';
import { sizingPreview, validateGroupConfig } from '@tradecopier/domain';
import { assertSameOrigin, readJsonBody, requireIdempotencyKey } from './guards.ts';
import { ApiError, handle, json } from './http.ts';
import { requirePrincipal, type ApiDeps } from './risk-profiles.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    leaderAccountId: z.string().regex(UUID),
    followers: z
      .array(
        z
          .object({
            accountId: z.string().regex(UUID),
            numerator: z.number().int(),
            denominator: z.number().int(),
            maxAbsPosition: z.number().int(),
            maxOrderQuantity: z.number().int(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

const activateBody = z.object({ expectedVersion: z.number().int().min(1) }).strict();

/** /api/v1/copier-groups handlers. Activation is a request; the worker performs the preflight. */
export function createCopierGroupsApi(deps: ApiDeps) {
  return {
    list: (request: Request) =>
      handle(async () => {
        const principal = await requirePrincipal(deps, request);
        const items = await withTenant(await deps.pool(), principal, (tx) => listCopierGroups(tx));
        return json({ items, asOf: new Date().toISOString() });
      }),

    get: (request: Request, groupId: string) =>
      handle(async () => {
        const principal = await requirePrincipal(deps, request);
        const group = await withTenant(await deps.pool(), principal, (tx) => getCopierGroup(tx, groupId));
        const preview = group.config.followers.map((f) => ({ accountId: f.accountId, examples: sizingPreview(f) }));
        return json({ group, preview, asOf: new Date().toISOString() });
      }),

    create: (request: Request) =>
      handle(async () => {
        assertSameOrigin(request, deps.allowedOrigins);
        const principal = await requirePrincipal(deps, request);
        const idempotencyKey = requireIdempotencyKey(request);
        const body = await readJsonBody(request, createBody);
        // Contracts come from the server's simulated catalog, never from the client.
        const config: StoredGroupConfig = {
          schemaVersion: 1,
          leaderAccountId: body.leaderAccountId,
          followers: body.followers,
          instruments: SIMULATED_CONTRACTS.map((c) => ({ ...c.instrument })),
        };
        const outcome = await executeIdempotent(
          await deps.pool(),
          principal,
          { idempotencyKey, kind: 'copier_group.create', payload: body },
          async (tx) => {
            const problems = validateGroupConfig(config, await listAccountFacts(tx));
            if (problems.length > 0) {
              throw new ApiError(422, 'invalid_copier_config', 'The copier settings are not valid.', { problems });
            }
            return createCopierGroup(tx, principal, body.name, config);
          },
        );
        return json({ operationId: outcome.operationId, replayed: outcome.replayed, group: outcome.result }, outcome.replayed ? 200 : 201);
      }),

    activate: (request: Request, groupId: string) =>
      handle(async () => {
        assertSameOrigin(request, deps.allowedOrigins);
        const principal = await requirePrincipal(deps, request);
        const idempotencyKey = requireIdempotencyKey(request);
        const body = await readJsonBody(request, activateBody);
        const outcome = await executeIdempotent(
          await deps.pool(),
          principal,
          { idempotencyKey, kind: 'copier_group.activate', payload: { groupId, ...body } },
          (tx) => requestActivation(tx, groupId, body.expectedVersion),
        );
        // Requested, not active: ACTIVE only after the worker's preflight and account claims.
        return json({ operationId: outcome.operationId, replayed: outcome.replayed, ...outcome.result }, 202);
      }),
  };
}
