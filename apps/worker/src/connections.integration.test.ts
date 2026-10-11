import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, createSimulatedConnection, listConnections, provisionUser, withTenant, type Pool, type ProvisionedUser } from '@tradecopier/database';
import { migrate } from '@tradecopier/database/migrate';
import { createLogger } from '@tradecopier/observability';
import { createConnectionSupervisor, seedFor } from './connections.ts';

/*
 * Connection workflow against a real PostgreSQL test database with the runtime
 * role: claim → connect → discover accounts → snapshot → READY, and recovery
 * after a worker restart without duplicating accounts.
 */

const adminUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && appUrl);
if (!enabled && process.env.REQUIRE_DB_TESTS === '1') {
  throw new Error('REQUIRE_DB_TESTS=1 but test database URLs are not set');
}

const quietLogger = createLogger({ service: 'test', write: () => {} });

describe.skipIf(!enabled)('connection supervisor (integration)', () => {
  let admin: Pool;
  let app: Pool;
  let owner: ProvisionedUser;
  let other: ProvisionedUser;

  beforeAll(async () => {
    admin = createPool({ connectionString: adminUrl!, applicationName: 'tradeplex-worker-test-admin', max: 1 });
    await migrate(admin);
    // Isolate this file from connections left by other suites.
    await admin.query("UPDATE app.broker_connections SET state = 'DISCONNECTED' WHERE state <> 'DISCONNECTED'");
    app = createPool({ connectionString: appUrl!, applicationName: 'tradeplex-worker-test', max: 4 });
    const run = randomUUID();
    owner = await provisionUser(app, `worker-test|owner|${run}`, 'Owner');
    other = await provisionUser(app, `worker-test|other|${run}`, 'Other');
  });

  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });

  it('establishes a simulated connection: discovers three flat accounts and becomes READY', async () => {
    const { id } = await withTenant(app, owner, (tx) => createSimulatedConnection(tx, owner, 'Worker test'));
    const supervisor = createConnectionSupervisor({ pool: app, logger: quietLogger });
    expect(await supervisor.tick()).toBe(1);

    const view = (await withTenant(app, owner, (tx) => listConnections(tx))).find((c) => c.id === id)!;
    expect(view.state).toBe('READY');
    expect(view.lastSnapshotAt).not.toBeNull();
    expect(view.accounts.map((a) => a.providerAccountId).sort()).toEqual(['SIM-FOLLOWER-A', 'SIM-FOLLOWER-B', 'SIM-LEADER-1']);
    for (const account of view.accounts) {
      expect(account.canonicalAccountId).toBe(`sim:${id}:${account.providerAccountId}`);
      expect(account.positions).toEqual([]);
      expect(account.openOrders).toBe(0);
      expect(account.snapshotCursor).toBe('0');
    }
    expect(supervisor.sessions.has(id)).toBe(true);

    // Another tenant sees none of it.
    expect(await withTenant(app, other, (tx) => listConnections(tx))).toEqual([]);
    // Nothing left to claim.
    expect(await supervisor.tick()).toBe(0);
  });

  it('re-establishes connections after a worker restart without duplicating accounts', async () => {
    const { id } = await withTenant(app, owner, (tx) => createSimulatedConnection(tx, owner, 'Restart test'));
    await createConnectionSupervisor({ pool: app, logger: quietLogger }).tick();

    const restarted = createConnectionSupervisor({ pool: app, logger: quietLogger });
    expect(restarted.sessions.size).toBe(0);
    expect(await restarted.recoverOnStartup()).toBeGreaterThanOrEqual(1);
    const during = (await withTenant(app, owner, (tx) => listConnections(tx))).find((c) => c.id === id)!;
    expect(during.state).toBe('RECONNECTING');

    // Drain every connection marked by the restart (other suites may leave some behind).
    while ((await restarted.tick()) > 0) {
      /* keep claiming */
    }
    const after = (await withTenant(app, owner, (tx) => listConnections(tx))).find((c) => c.id === id)!;
    expect(after.state).toBe('READY');
    expect(after.accounts).toHaveLength(3);
    expect(restarted.sessions.has(id)).toBe(true);
  });

  it('derives a stable simulator seed per connection', () => {
    const id = randomUUID();
    expect(seedFor(id)).toBe(seedFor(id));
    expect(seedFor(id)).not.toBe(seedFor(randomUUID()));
  });
});
