import { createHash } from 'node:crypto';
import {
  SIMULATED_ACCOUNT_SET,
  SIMULATED_CONTRACTS,
  SimulatedBroker,
} from '@tradecopier/broker-simulated';
import {
  claimConnectionWork,
  markConnectionsForReconnect,
  recordDiscoveredAccounts,
  setConnectionState,
  withTenant,
  type ClaimedConnection,
  type DiscoveredAccount,
  type Pool,
} from '@tradecopier/database';
import type { Logger } from '@tradecopier/observability';

export interface ConnectionSupervisorDeps {
  readonly pool: Pool;
  readonly logger: Logger;
  readonly now?: () => Date;
  /** Connections claimed per tick; bounded so one tenant cannot starve others. */
  readonly batchSize?: number;
}

export interface ConnectionSupervisor {
  /** After a restart, sessions are gone: mark previously live connections for re-establishment. */
  recoverOnStartup(): Promise<number>;
  /** Claims waiting connections and establishes them. Returns how many were processed. */
  tick(): Promise<number>;
  /** Live in-memory sessions by connection ID (owned only by this worker process). */
  readonly sessions: ReadonlyMap<string, SimulatedBroker>;
}

/** Deterministic per-connection simulator seed, so a connection replays identically. */
export function seedFor(connectionId: string): number {
  return createHash('sha256').update(connectionId).digest().readUInt32BE(0);
}

/**
 * Establishes broker sessions for claimed connections (BROKER_ADAPTERS.md
 * lifecycle CREATED → CONNECTING → SNAPSHOTTING → READY). A socket being open
 * is not READY: READY requires authentication, connection and a first snapshot
 * of every discovered account. Only the simulator is supported in this build.
 */
export function createConnectionSupervisor(deps: ConnectionSupervisorDeps): ConnectionSupervisor {
  const now = deps.now ?? (() => new Date());
  const sessions = new Map<string, SimulatedBroker>();
  const log = deps.logger;

  async function establish(claim: ClaimedConnection): Promise<void> {
    const scoped = log.child({ connectionId: claim.connectionId, tenant: claim.tenantId.slice(0, 8) });
    if (claim.provider !== 'simulated' || claim.environment !== 'SIMULATED') {
      await withTenant(deps.pool, claim, (tx) =>
        setConnectionState(tx, claim.connectionId, 'BLOCKED', 'This provider is not approved in this build.'),
      );
      scoped.warn('connection blocked: provider not approved');
      return;
    }
    try {
      const sim = new SimulatedBroker({
        seed: seedFor(claim.connectionId),
        startTime: now().toISOString(),
        accounts: SIMULATED_ACCOUNT_SET,
        contracts: SIMULATED_CONTRACTS,
        connectionId: claim.connectionId,
        accountNamespace: claim.connectionId,
      });
      const auth = await sim.authenticate('sim:worker');
      if (auth.state !== 'AUTHENTICATED') throw new Error('simulator authentication failed');
      await withTenant(deps.pool, claim, (tx) => setConnectionState(tx, claim.connectionId, 'SNAPSHOTTING', null));
      if ((await sim.connect()) !== 'READY') throw new Error('simulator did not become ready');

      const discovered: DiscoveredAccount[] = [];
      for (const ref of await sim.getAccounts()) {
        const snapshot = await sim.getAccountState(ref.canonicalAccountId);
        if (!snapshot.complete) throw new Error('incomplete snapshot');
        const config = SIMULATED_ACCOUNT_SET.find((a) => a.providerAccountId === ref.providerAccountId);
        discovered.push({
          providerAccountId: ref.providerAccountId,
          canonicalAccountId: ref.canonicalAccountId,
          displayName: config?.displayName ?? ref.providerAccountId,
          positions: snapshot.positions,
          openOrders: snapshot.orders.filter((o) => o.status === 'WORKING' || o.status === 'PARTIALLY_FILLED').length,
          snapshotCursor: snapshot.cursor,
          snapshotAsOf: snapshot.asOf,
        });
      }

      await withTenant(deps.pool, claim, async (tx) => {
        await recordDiscoveredAccounts(tx, claim, claim.connectionId, discovered);
        await setConnectionState(tx, claim.connectionId, 'READY', null, now());
      });
      sessions.set(claim.connectionId, sim);
      scoped.info('connection ready', { accounts: discovered.length });
    } catch (err) {
      sessions.delete(claim.connectionId);
      scoped.error('connection failed', { err });
      await withTenant(deps.pool, claim, (tx) =>
        setConnectionState(tx, claim.connectionId, 'DISCONNECTED', 'The connection could not be established. It will not retry on its own.'),
      ).catch((stateErr: unknown) => scoped.error('could not record connection failure', { err: stateErr }));
    }
  }

  return {
    sessions,
    async recoverOnStartup() {
      const marked = await markConnectionsForReconnect(deps.pool);
      if (marked > 0) log.info('connections marked for re-establishment after restart', { marked });
      return marked;
    },
    async tick() {
      const claimed = await claimConnectionWork(deps.pool, deps.batchSize ?? 5);
      for (const claim of claimed) await establish(claim);
      return claimed.length;
    },
  };
}
