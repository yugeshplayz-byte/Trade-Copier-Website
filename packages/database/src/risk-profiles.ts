import { z } from 'zod';
import { ConfigVersionConflictError, NotFoundError } from './errors.ts';
import type { TenantContext, Tx } from './tenant.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Immutable risk limits for one profile version (RISK_ENGINE.md MVP controls). */
export const riskLimitsSchema = z
  .object({
    maxAbsPosition: z.number().int().min(1).max(1000),
    maxOrderQuantity: z.number().int().min(1).max(1000),
    allowedProducts: z.array(z.string().regex(/^[A-Z0-9]{1,10}$/)).min(1).max(50),
  })
  .strict()
  .refine((l) => l.maxOrderQuantity <= l.maxAbsPosition, {
    message: 'maxOrderQuantity cannot exceed maxAbsPosition',
  });

export type RiskLimits = z.infer<typeof riskLimitsSchema>;

export interface RiskProfile {
  readonly id: string;
  readonly name: string;
  readonly currentVersion: number;
  readonly versions: readonly { version: number; limits: RiskLimits; createdAt: string }[];
}

export async function createRiskProfile(tx: Tx, ctx: TenantContext, name: string): Promise<{ id: string }> {
  if (name.length < 1 || name.length > 100) throw new RangeError('name must be 1-100 characters');
  const { rows } = await tx.query<{ id: string }>(
    'INSERT INTO app.risk_profiles (tenant_id, name) VALUES ($1, $2) RETURNING id',
    [ctx.tenantId, name],
  );
  return { id: rows[0]!.id };
}

/**
 * Publishes a new immutable version. The caller states the version it last saw;
 * if another change landed first, a conflict is raised instead of overwriting it.
 */
export async function publishRiskProfileVersion(
  tx: Tx,
  ctx: TenantContext,
  input: { profileId: string; expectedVersion: number; limits: unknown },
): Promise<{ version: number }> {
  const limits = riskLimitsSchema.parse(input.limits);
  if (!UUID.test(input.profileId)) throw new NotFoundError('risk profile not found');

  const current = await tx.query<{ current_version: number }>(
    'SELECT current_version FROM app.risk_profiles WHERE id = $1 FOR UPDATE',
    [input.profileId],
  );
  const row = current.rows[0];
  if (!row) throw new NotFoundError('risk profile not found');
  if (row.current_version !== input.expectedVersion) throw new ConfigVersionConflictError(row.current_version);

  const version = row.current_version + 1;
  await tx.query(
    `INSERT INTO app.risk_profile_versions (tenant_id, profile_id, version, limits, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [ctx.tenantId, input.profileId, version, JSON.stringify(limits), ctx.userId],
  );
  await tx.query('UPDATE app.risk_profiles SET current_version = $2 WHERE id = $1', [input.profileId, version]);
  return { version };
}

export interface RiskProfileSummary {
  readonly id: string;
  readonly name: string;
  readonly currentVersion: number;
  readonly createdAt: string;
}

/** Profiles visible to the current tenant context (row-level security filters the rest). */
export async function listRiskProfiles(tx: Tx): Promise<RiskProfileSummary[]> {
  const { rows } = await tx.query<{ id: string; name: string; current_version: number; created_at: Date }>(
    'SELECT id, name, current_version, created_at FROM app.risk_profiles ORDER BY created_at, id LIMIT 200',
  );
  return rows.map((r) => ({ id: r.id, name: r.name, currentVersion: r.current_version, createdAt: r.created_at.toISOString() }));
}

export async function getRiskProfile(tx: Tx, profileId: string): Promise<RiskProfile> {
  if (!UUID.test(profileId)) throw new NotFoundError('risk profile not found');
  const profile = await tx.query<{ id: string; name: string; current_version: number }>(
    'SELECT id, name, current_version FROM app.risk_profiles WHERE id = $1',
    [profileId],
  );
  const row = profile.rows[0];
  if (!row) throw new NotFoundError('risk profile not found');
  const versions = await tx.query<{ version: number; limits: RiskLimits; created_at: Date }>(
    'SELECT version, limits, created_at FROM app.risk_profile_versions WHERE profile_id = $1 ORDER BY version',
    [profileId],
  );
  return {
    id: row.id,
    name: row.name,
    currentVersion: row.current_version,
    versions: versions.rows.map((v) => ({ version: v.version, limits: v.limits, createdAt: v.created_at.toISOString() })),
  };
}
