import { z } from 'zod';
import {
  createRiskProfile,
  executeIdempotent,
  getRiskProfile,
  listRiskProfiles,
  publishRiskProfileVersion,
  riskLimitsSchema,
  withTenant,
  type Pool,
} from '@tradecopier/database';
import { assertSameOrigin, readJsonBody, requireIdempotencyKey } from './guards.ts';
import { ApiError, handle, json } from './http.ts';
import type { Principal, PrincipalResolver } from './principal.ts';

export interface ApiDeps {
  readonly pool: () => Promise<Pool>;
  readonly resolvePrincipal: PrincipalResolver;
  readonly allowedOrigins: readonly string[];
}

// Strict schemas: unknown fields (including any client-supplied tenant ID) are rejected.
const createBody = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const publishBody = z.object({ expectedVersion: z.number().int().min(0), limits: riskLimitsSchema }).strict();

async function requirePrincipal(deps: ApiDeps, request: Request): Promise<Principal> {
  const principal = await deps.resolvePrincipal(request);
  if (!principal) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  return principal;
}

/** /api/v1/risk-profiles handlers. Thin: validation and authorization here, logic in packages/database. */
export function createRiskProfileApi(deps: ApiDeps) {
  return {
    list: (request: Request) =>
      handle(async () => {
        const principal = await requirePrincipal(deps, request);
        const items = await withTenant(await deps.pool(), principal, (tx) => listRiskProfiles(tx));
        return json({ items, asOf: new Date().toISOString() });
      }),

    create: (request: Request) =>
      handle(async () => {
        assertSameOrigin(request, deps.allowedOrigins);
        const principal = await requirePrincipal(deps, request);
        const idempotencyKey = requireIdempotencyKey(request);
        const body = await readJsonBody(request, createBody);
        const outcome = await executeIdempotent(
          await deps.pool(),
          principal,
          { idempotencyKey, kind: 'risk_profile.create', payload: body },
          (tx) => createRiskProfile(tx, principal, body.name),
        );
        return json(
          { operationId: outcome.operationId, replayed: outcome.replayed, profile: outcome.result },
          outcome.replayed ? 200 : 201,
        );
      }),

    get: (request: Request, profileId: string) =>
      handle(async () => {
        const principal = await requirePrincipal(deps, request);
        const profile = await withTenant(await deps.pool(), principal, (tx) => getRiskProfile(tx, profileId));
        return json({ profile, asOf: new Date().toISOString() });
      }),

    publishVersion: (request: Request, profileId: string) =>
      handle(async () => {
        assertSameOrigin(request, deps.allowedOrigins);
        const principal = await requirePrincipal(deps, request);
        const idempotencyKey = requireIdempotencyKey(request);
        const body = await readJsonBody(request, publishBody);
        const outcome = await executeIdempotent(
          await deps.pool(),
          principal,
          { idempotencyKey, kind: 'risk_profile.publish_version', payload: { profileId, ...body } },
          (tx) => publishRiskProfileVersion(tx, principal, { profileId, ...body }),
        );
        return json(
          { operationId: outcome.operationId, replayed: outcome.replayed, version: outcome.result.version },
          outcome.replayed ? 200 : 201,
        );
      }),
  };
}
