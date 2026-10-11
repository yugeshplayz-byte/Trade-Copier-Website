import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SIM_MNQ, SIMULATED_CONTRACTS } from '@tradecopier/broker-simulated';
import {
  createCopierGroup,
  createPool,
  createSimulatedConnection,
  getCopierGroup,
  listAccountFacts,
  provisionUser,
  requestActivation,
  withTenant,
  type AccountFact,
  type Pool,
  type ProvisionedUser,
  type StoredGroupConfig,
} from '@tradecopier/database';
import { migrate } from '@tradecopier/database/migrate';
import { createLogger } from '@tradecopier/observability';
import { createActivationProcessor } from './activation.ts';
import { createConnectionSupervisor } from './connections.ts';

const adminUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && appUrl);
if (!enabled && process.env.REQUIRE_DB_TESTS === '1') {
  throw new Error('REQUIRE_DB_TESTS=1 but test database URLs are not set');
}

const quiet = createLogger({ service: 'test', write: () => {} });

describe.skipIf(!enabled)('copier activation (integration)', () => {
  let admin: Pool;
  let app: Pool;
  let user: ProvisionedUser;
  let supervisor: ReturnType<typeof createConnectionSupervisor>;
  let accounts: AccountFact[];

  const byName = (providerAccountId: string) => accounts.find((a) => a.canonicalAccountId.endsWith(`:${providerAccountId}`))!;
  const config = (leader: string, followers: string[]): StoredGroupConfig => ({
    schemaVersion: 1,
    leaderAccountId: byName(leader).id,
    followers: followers.map((f) => ({ accountId: byName(f).id, numerator: 1, denominator: 1, maxAbsPosition: 4, maxOrderQuantity: 2 })),
    instruments: SIMULATED_CONTRACTS.map((c) => ({ ...c.instrument })),
  });
  const draft = (name: string, cfg: StoredGroupConfig) => withTenant(app, user, (tx) => createCopierGroup(tx, user, name, cfg));
  const arm = (id: string) => withTenant(app, user, (tx) => requestActivation(tx, id, 1));
  const view = (id: string) => withTenant(app, user, (tx) => getCopierGroup(tx, id));

  beforeAll(async () => {
    admin = createPool({ connectionString: adminUrl!, applicationName: 'tradeplex-activation-admin', max: 1 });
    await migrate(admin);
    // Start from a clean scheduling state in the shared test database.
    await admin.query("UPDATE app.broker_connections SET state = 'DISCONNECTED' WHERE state <> 'DISCONNECTED'");
    await admin.query("UPDATE app.copier_groups SET desired_state = 'DISABLED' WHERE desired_state = 'ARMING'");
    app = createPool({ connectionString: appUrl!, applicationName: 'tradeplex-activation', max: 4 });
    user = await provisionUser(app, `activation|${randomUUID()}`, 'Activation');
    await withTenant(app, user, (tx) => createSimulatedConnection(tx, user, 'Activation sim'));
    supervisor = createConnectionSupervisor({ pool: app, logger: quiet });
    await supervisor.tick();
    accounts = await withTenant(app, user, (tx) => listAccountFacts(tx));
  });

  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });

  it('activates one leader and two flat followers: claims accounts, freezes settings, records the boundary', async () => {
    const group = await draft('First copier', config('SIM-LEADER-1', ['SIM-FOLLOWER-A', 'SIM-FOLLOWER-B']));
    expect((await arm(group.id)).desiredState).toBe('ARMING');
    const processor = createActivationProcessor({ pool: app, logger: quiet, sessions: supervisor.sessions });
    expect(await processor.tick()).toBe(1);

    const active = await view(group.id);
    expect(active).toMatchObject({ desiredState: 'ACTIVE', activeVersion: 1, controlEpoch: 1, stateReason: null });
    expect([...active.claimedAccountIds].sort()).toEqual([byName('SIM-LEADER-1').id, byName('SIM-FOLLOWER-A').id, byName('SIM-FOLLOWER-B').id].sort());
    const boundary = (await admin.query('SELECT activation_boundary FROM app.copier_groups WHERE id = $1', [group.id])).rows[0].activation_boundary;
    expect(Object.keys(boundary)).toHaveLength(3);
  });

  it('refuses an account that already belongs to another active copier', async () => {
    const second = await draft('Second copier', config('SIM-FOLLOWER-A', ['SIM-FOLLOWER-B']));
    await arm(second.id);
    await createActivationProcessor({ pool: app, logger: quiet, sessions: supervisor.sessions }).tick();
    const blocked = await view(second.id);
    expect(blocked.desiredState).toBe('DRAFT');
    expect(blocked.stateReason).toContain('already belongs to another active copier');
    expect(blocked.claimedAccountIds).toEqual([]);
  });

  it('never adopts an open position: a non-flat follower blocks activation', async () => {
    // A separate connection so its accounts are unclaimed.
    const otherConn = (await withTenant(app, user, (tx) => createSimulatedConnection(tx, user, 'Busy sim'))).id;
    await supervisor.tick();
    accounts = await withTenant(app, user, (tx) => listAccountFacts(tx));
    const onOther = (p: string) => accounts.find((a) => a.connectionId === otherConn && a.canonicalAccountId.endsWith(`:${p}`))!;

    const sim = supervisor.sessions.get(otherConn)!;
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001 });
    const follower = onOther('SIM-FOLLOWER-A');
    const ref = (await sim.getAccounts()).find((a) => a.canonicalAccountId === follower.canonicalAccountId)!;
    await sim.placeOrder({
      commandId: 'manual-1',
      attemptId: 'manual-1-a1',
      clientOrderId: 'manual-1',
      account: ref,
      instrument: SIM_MNQ,
      side: 'BUY',
      quantity: 1,
      orderType: 'MARKET',
      timeInForce: 'DAY',
    });

    const group = await draft('Busy copier', {
      ...config('SIM-LEADER-1', []),
      leaderAccountId: onOther('SIM-LEADER-1').id,
      followers: [{ accountId: follower.id, numerator: 1, denominator: 1, maxAbsPosition: 4, maxOrderQuantity: 2 }],
    });
    await arm(group.id);
    await createActivationProcessor({ pool: app, logger: quiet, sessions: supervisor.sessions }).tick();
    const blocked = await view(group.id);
    expect(blocked.desiredState).toBe('DRAFT');
    expect(blocked.stateReason).toContain('has an open position');
  });

  it('blocks activation when no live broker session exists (for example right after a restart)', async () => {
    const otherConn = (await withTenant(app, user, (tx) => createSimulatedConnection(tx, user, 'Sessionless sim'))).id;
    await supervisor.tick();
    accounts = await withTenant(app, user, (tx) => listAccountFacts(tx));
    const onOther = (p: string) => accounts.find((a) => a.connectionId === otherConn && a.canonicalAccountId.endsWith(`:${p}`))!;
    const group = await draft('Sessionless copier', {
      ...config('SIM-LEADER-1', []),
      leaderAccountId: onOther('SIM-LEADER-1').id,
      followers: [{ accountId: onOther('SIM-FOLLOWER-B').id, numerator: 1, denominator: 1, maxAbsPosition: 4, maxOrderQuantity: 2 }],
    });
    await arm(group.id);
    // A freshly started processor with no sessions, as after a worker restart.
    await createActivationProcessor({ pool: app, logger: quiet, sessions: new Map() }).tick();
    const blocked = await view(group.id);
    expect(blocked.desiredState).toBe('DRAFT');
    expect(blocked.stateReason).toContain('no live broker session');
  });
});
