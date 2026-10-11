import { z } from 'zod';
import { ConfigVersionConflictError, NotFoundError, StateConflictError } from './errors.ts';
import type { Pool } from './pool.ts';
import type { TenantContext, Tx, UserContext } from './tenant.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID);
const term = z.number().int().min(1).max(100);

/** Stored copier configuration, schema version 1 (validated on write and read). */
export const groupConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    leaderAccountId: uuid,
    followers: z
      .array(
        z
          .object({
            accountId: uuid,
            numerator: term,
            denominator: term,
            maxAbsPosition: z.number().int().min(1).max(100),
            maxOrderQuantity: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    instruments: z
      .array(
        z
          .object({
            exchange: z.string().min(1).max(32),
            product: z.string().min(1).max(32),
            expiry: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
            currency: z.string().regex(/^[A-Z]{3}$/),
            providerContractId: z.string().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();

export type StoredGroupConfig = z.infer<typeof groupConfigSchema>;

export type DesiredState = 'DRAFT' | 'ARMING' | 'ACTIVE' | 'PAUSING' | 'PAUSED' | 'EXIT_ONLY' | 'HALTED' | 'FLATTENING' | 'DISABLED';

export interface AccountFact {
  readonly id: string;
  readonly canonicalAccountId: string;
  readonly connectionId: string;
  readonly environment: string;
  readonly connectionState: string;
  readonly label: string;
}

export interface CopierGroupView {
  readonly id: string;
  readonly name: string;
  readonly mode: 'EXECUTION';
  readonly desiredState: DesiredState;
  readonly stateReason: string | null;
  readonly currentVersion: number;
  readonly activeVersion: number | null;
  readonly controlEpoch: number;
  readonly activatedAt: string | null;
  readonly config: StoredGroupConfig;
  readonly claimedAccountIds: readonly string[];
}

/** Accounts the current tenant may place in a copier, with connection state. */
export async function listAccountFacts(tx: Tx): Promise<AccountFact[]> {
  const { rows } = await tx.query<{
    id: string;
    canonical_account_id: string;
    connection_id: string;
    environment: string;
    connection_state: string;
    label: string;
  }>(
    `SELECT a.id, a.canonical_account_id, a.connection_id, a.environment, c.state AS connection_state, a.display_name AS label
       FROM app.broker_accounts a JOIN app.broker_connections c ON c.id = a.connection_id
      ORDER BY a.display_name, a.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    canonicalAccountId: r.canonical_account_id,
    connectionId: r.connection_id,
    environment: r.environment,
    connectionState: r.connection_state,
    label: r.label,
  }));
}

/** Creates a DRAFT copier with settings version 1. Validate the config with the domain rules first. */
export async function createCopierGroup(tx: Tx, ctx: UserContext, name: string, config: StoredGroupConfig): Promise<{ id: string; desiredState: DesiredState; currentVersion: number }> {
  const parsed = groupConfigSchema.parse(config);
  const { rows } = await tx.query<{ id: string }>(
    'INSERT INTO app.copier_groups (tenant_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
    [ctx.tenantId, name, ctx.userId],
  );
  const id = rows[0]!.id;
  await tx.query(
    'INSERT INTO app.copy_settings_versions (tenant_id, group_id, version, config, created_by) VALUES ($1, $2, 1, $3, $4)',
    [ctx.tenantId, id, JSON.stringify(parsed), ctx.userId],
  );
  return { id, desiredState: 'DRAFT', currentVersion: 1 };
}

interface GroupRow {
  id: string;
  name: string;
  mode: 'EXECUTION';
  desired_state: DesiredState;
  state_reason: string | null;
  current_version: number;
  active_version: number | null;
  control_epoch: number;
  activated_at: Date | null;
  config: unknown;
}

async function groupRows(tx: Tx, where: string, params: unknown[]): Promise<CopierGroupView[]> {
  const { rows } = await tx.query<GroupRow>(
    `SELECT g.id, g.name, g.mode, g.desired_state, g.state_reason, g.current_version, g.active_version,
            g.control_epoch, g.activated_at, v.config
       FROM app.copier_groups g
       JOIN app.copy_settings_versions v ON v.group_id = g.id AND v.version = g.current_version
      ${where}
      ORDER BY g.created_at, g.id LIMIT 100`,
    params,
  );
  const claims = await tx.query<{ group_id: string; account_id: string }>(
    'SELECT group_id, account_id FROM app.account_claims WHERE released_at IS NULL',
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    desiredState: r.desired_state,
    stateReason: r.state_reason,
    currentVersion: r.current_version,
    activeVersion: r.active_version,
    controlEpoch: r.control_epoch,
    activatedAt: r.activated_at?.toISOString() ?? null,
    config: groupConfigSchema.parse(r.config),
    claimedAccountIds: claims.rows.filter((c) => c.group_id === r.id).map((c) => c.account_id),
  }));
}

export function listCopierGroups(tx: Tx): Promise<CopierGroupView[]> {
  return groupRows(tx, '', []);
}

export async function getCopierGroup(tx: Tx, groupId: string): Promise<CopierGroupView> {
  if (!UUID.test(groupId)) throw new NotFoundError('copier not found');
  const [group] = await groupRows(tx, 'WHERE g.id = $1', [groupId]);
  if (!group) throw new NotFoundError('copier not found');
  return group;
}

/**
 * Requests activation. The worker runs the preflight with fresh snapshots and
 * claims accounts; this only records the request (ARMING).
 */
export async function requestActivation(tx: Tx, groupId: string, expectedVersion: number): Promise<{ desiredState: DesiredState }> {
  if (!UUID.test(groupId)) throw new NotFoundError('copier not found');
  const { rows } = await tx.query<{ desired_state: DesiredState; current_version: number }>(
    'SELECT desired_state, current_version FROM app.copier_groups WHERE id = $1 FOR UPDATE',
    [groupId],
  );
  const row = rows[0];
  if (!row) throw new NotFoundError('copier not found');
  if (row.current_version !== expectedVersion) throw new ConfigVersionConflictError(row.current_version);
  if (row.desired_state !== 'DRAFT') throw new StateConflictError(`A copier that is ${row.desired_state} cannot be activated.`);
  await tx.query(
    `UPDATE app.copier_groups
        SET desired_state = 'ARMING', state_reason = 'Waiting for the execution worker to run activation checks.',
            work_claimed_at = NULL, updated_at = now()
      WHERE id = $1`,
    [groupId],
  );
  return { desiredState: 'ARMING' };
}

/* ---------------- Worker side ---------------- */

export interface ClaimedActivation extends TenantContext {
  readonly groupId: string;
}

export async function claimGroupActivations(pool: Pool, limit: number): Promise<ClaimedActivation[]> {
  const { rows } = await pool.query<{ out_group_id: string; out_tenant_id: string }>(
    'SELECT out_group_id, out_tenant_id FROM app.claim_group_activations($1)',
    [limit],
  );
  return rows.map((r) => ({ groupId: r.out_group_id, tenantId: r.out_tenant_id, userId: null }));
}

export interface ActivationBoundary {
  readonly [accountId: string]: { readonly cursor: string; readonly asOf: string };
}

/**
 * Atomically claims every account and activates the copier, provided it is
 * still ARMING at the expected version. A unique-index violation means an
 * account already belongs to another active copier.
 */
export async function completeActivation(
  tx: Tx,
  ctx: TenantContext,
  groupId: string,
  version: number,
  config: StoredGroupConfig,
  boundary: ActivationBoundary,
): Promise<void> {
  const { rows } = await tx.query<{ desired_state: DesiredState; current_version: number }>(
    'SELECT desired_state, current_version FROM app.copier_groups WHERE id = $1 FOR UPDATE',
    [groupId],
  );
  const row = rows[0];
  if (!row || row.desired_state !== 'ARMING' || row.current_version !== version) {
    throw new StateConflictError('The copier changed while activation checks were running.');
  }
  const members = [
    { accountId: config.leaderAccountId, role: 'LEADER' },
    ...config.followers.map((f) => ({ accountId: f.accountId, role: 'FOLLOWER' })),
  ];
  for (const m of members) {
    await tx.query('INSERT INTO app.account_claims (tenant_id, group_id, account_id, role) VALUES ($1, $2, $3, $4)', [
      ctx.tenantId,
      groupId,
      m.accountId,
      m.role,
    ]);
  }
  await tx.query(
    `UPDATE app.copier_groups
        SET desired_state = 'ACTIVE', state_reason = NULL, active_version = $2, control_epoch = control_epoch + 1,
            activated_at = now(), activation_boundary = $3, work_claimed_at = NULL, updated_at = now()
      WHERE id = $1`,
    [groupId, version, JSON.stringify(boundary)],
  );
}

/** Returns the copier to DRAFT with every blocker listed. */
export async function failActivation(tx: Tx, groupId: string, blockers: readonly string[]): Promise<void> {
  await tx.query(
    `UPDATE app.copier_groups
        SET desired_state = 'DRAFT', state_reason = $2, work_claimed_at = NULL, updated_at = now()
      WHERE id = $1 AND desired_state = 'ARMING'`,
    [groupId, `Activation blocked: ${blockers.join(' ')}`.slice(0, 1000)],
  );
}
