import { TERMINAL_ORDER_STATUSES } from '@tradecopier/contracts';
import type { SimulatedBroker } from '@tradecopier/broker-simulated';
import {
  StateConflictError,
  claimGroupActivations,
  completeActivation,
  failActivation,
  getCopierGroup,
  listAccountFacts,
  withTenant,
  type ActivationBoundary,
  type ClaimedActivation,
  type Pool,
} from '@tradecopier/database';
import { validateGroupConfig } from '@tradecopier/domain';
import type { Logger } from '@tradecopier/observability';

export interface ActivationProcessorDeps {
  readonly pool: Pool;
  readonly logger: Logger;
  /** Live broker sessions by connection ID, owned by the connection supervisor. */
  readonly sessions: ReadonlyMap<string, SimulatedBroker>;
  readonly batchSize?: number;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
}

/**
 * Activation preflight (MASTER_SPEC contract 3). For a copier in ARMING, re-validates
 * the configuration, reads a fresh snapshot of every account from its live
 * session, requires all accounts flat with no working orders, then atomically
 * claims the accounts, freezes the settings version, records the activation
 * boundary and marks it ACTIVE. Any blocker returns it to DRAFT with every
 * blocker listed. Existing positions are never adopted.
 */
export function createActivationProcessor(deps: ActivationProcessorDeps) {
  const log = deps.logger;

  async function process(claim: ClaimedActivation): Promise<void> {
    const scoped = log.child({ groupId: claim.groupId, tenant: claim.tenantId.slice(0, 8) });
    const { group, facts } = await withTenant(deps.pool, claim, async (tx) => ({
      group: await getCopierGroup(tx, claim.groupId),
      facts: await listAccountFacts(tx),
    }));
    if (group.desiredState !== 'ARMING') return;

    const config = group.config;
    const blockers = validateGroupConfig(config, facts);
    const boundary: Record<string, { cursor: string; asOf: string }> = {};
    const members = [config.leaderAccountId, ...config.followers.map((f) => f.accountId)];

    for (const accountId of members) {
      const fact = facts.find((f) => f.id === accountId);
      if (!fact) continue; // already reported by validation
      const session = deps.sessions.get(fact.connectionId);
      if (!session || session.connectionState() !== 'READY') {
        blockers.push(`${fact.label}: no live broker session. Reconnect it, then activate again.`);
        continue;
      }
      const snapshot = await session.getAccountState(fact.canonicalAccountId);
      if (!snapshot.complete) {
        blockers.push(`${fact.label}: the account snapshot was incomplete.`);
        continue;
      }
      if (snapshot.positions.some((p) => p.netQuantity !== 0)) {
        blockers.push(`${fact.label} has an open position. Activation requires every account to be flat.`);
      }
      if (snapshot.orders.some((o) => !TERMINAL_ORDER_STATUSES.has(o.status))) {
        blockers.push(`${fact.label} has working orders. Activation requires none.`);
      }
      boundary[fact.id] = { cursor: snapshot.cursor, asOf: snapshot.asOf };
    }

    const unique = [...new Set(blockers)];
    if (unique.length > 0) {
      await withTenant(deps.pool, claim, (tx) => failActivation(tx, claim.groupId, unique));
      scoped.info('activation blocked', { blockers: unique.length });
      return;
    }

    try {
      await withTenant(deps.pool, claim, (tx) =>
        completeActivation(tx, claim, claim.groupId, group.currentVersion, config, boundary as ActivationBoundary),
      );
      scoped.info('copier activated', { version: group.currentVersion, accounts: members.length });
    } catch (err) {
      if (err instanceof StateConflictError) {
        scoped.warn('copier changed during activation; skipped');
        return;
      }
      const reason = isUniqueViolation(err)
        ? 'An account in this copier already belongs to another active copier.'
        : 'Activation failed unexpectedly. Nothing was activated.';
      if (!isUniqueViolation(err)) scoped.error('activation failed', { err });
      await withTenant(deps.pool, claim, (tx) => failActivation(tx, claim.groupId, [reason]));
    }
  }

  return {
    async tick(): Promise<number> {
      const claimed = await claimGroupActivations(deps.pool, deps.batchSize ?? 5);
      for (const claim of claimed) await process(claim);
      return claimed.length;
    },
  };
}
