import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPool,
  createSimulatedConnection,
  provisionUser,
  recordDiscoveredAccounts,
  setConnectionState,
  withTenant,
  type Pool,
} from '@tradecopier/database';
import { migrate } from '@tradecopier/database/migrate';
import { createCopierGroupsApi } from './copier-groups.ts';
import type { Principal, PrincipalResolver } from './principal.ts';

const adminUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && appUrl);
if (!enabled && process.env.REQUIRE_DB_TESTS === '1') {
  throw new Error('REQUIRE_DB_TESTS=1 but test database URLs are not set');
}

const ORIGIN = 'http://127.0.0.1:3000';

interface Body {
  group: { id: string; desiredState: string; currentVersion: number };
  preview: { accountId: string; examples: { leader: number; follower: number; skippedRounding: boolean }[] }[];
  items: { id: string }[];
  error: { code: string; problems?: string[]; currentVersion?: number };
  desiredState: string;
  replayed: boolean;
  operationId: string;
}

describe.skipIf(!enabled)('copier groups API (integration)', () => {
  let admin: Pool;
  let app: Pool;
  const principals = new Map<string, Principal>();
  const accountIds = new Map<string, Record<string, string>>();
  const resolver: PrincipalResolver = async (r) => principals.get(r.headers.get('x-test-principal') ?? '') ?? null;
  let api: ReturnType<typeof createCopierGroupsApi>;

  const call = (who: string | null, init: { method?: string; body?: unknown; key?: string } = {}) =>
    new Request(`${ORIGIN}/api/v1/copier-groups`, {
      method: init.method ?? 'GET',
      headers: {
        origin: ORIGIN,
        ...(who ? { 'x-test-principal': who } : {}),
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.key ? { 'idempotency-key': init.key } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  const read = async (res: Response) => (await res.json()) as Body;
  const follower = (accountId: string, over = {}) => ({ accountId, numerator: 1, denominator: 2, maxAbsPosition: 4, maxOrderQuantity: 2, ...over });

  beforeAll(async () => {
    admin = createPool({ connectionString: adminUrl!, applicationName: 'tradeplex-groups-api-admin', max: 1 });
    await migrate(admin);
    app = createPool({ connectionString: appUrl!, applicationName: 'tradeplex-groups-api', max: 4 });
    const run = randomUUID();
    for (const name of ['alice', 'bob']) {
      const u = await provisionUser(app, `groups-api|${name}|${run}`, name);
      principals.set(name, { userId: u.userId, tenantId: u.tenantId, mfaVerified: false });
      const ids = await withTenant(app, u, async (tx) => {
        const c = await createSimulatedConnection(tx, u, `${name} sim`);
        const snap = { positions: [], openOrders: 0, snapshotCursor: '0', snapshotAsOf: new Date().toISOString() };
        await recordDiscoveredAccounts(
          tx,
          u,
          c.id,
          ['L', 'A', 'B'].map((p) => ({ providerAccountId: p, canonicalAccountId: `sim:${c.id}:${p}`, displayName: `${name} ${p}`, ...snap })),
        );
        await setConnectionState(tx, c.id, 'READY', null, new Date());
        const { rows } = await tx.query<{ id: string; provider_account_id: string }>(
          'SELECT id, provider_account_id FROM app.broker_accounts WHERE connection_id = $1',
          [c.id],
        );
        return Object.fromEntries(rows.map((r) => [r.provider_account_id, r.id]));
      });
      accountIds.set(name, ids);
    }
    api = createCopierGroupsApi({ pool: async () => app, resolvePrincipal: resolver, allowedOrigins: [ORIGIN] });
  });

  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });

  it('creates a DRAFT copier and shows the sizing preview', async () => {
    const a = accountIds.get('alice')!;
    const res = await api.create(
      call('alice', { method: 'POST', body: { name: 'Main', leaderAccountId: a.L, followers: [follower(a.A!), follower(a.B!, { numerator: 2, denominator: 1 })] }, key: 'grp-create-01' }),
    );
    expect(res.status).toBe(201);
    const { group } = await read(res);
    expect(group).toMatchObject({ desiredState: 'DRAFT', currentVersion: 1 });
    const detail = await read(await api.get(call('alice'), group.id));
    expect(detail.preview.find((p) => p.accountId === a.A)!.examples.map((e) => e.follower)).toEqual([0, 1, 1, 0]);
    expect(detail.preview.find((p) => p.accountId === a.B)!.examples.map((e) => e.follower)).toEqual([2, 4, 6, -2]);
  });

  it('rejects invalid settings with every problem listed', async () => {
    const a = accountIds.get('alice')!;
    const res = await api.create(
      call('alice', { method: 'POST', body: { name: 'Bad', leaderAccountId: a.L, followers: [follower(a.L!), follower(a.A!, { maxOrderQuantity: 9 })] }, key: 'grp-create-02' }),
    );
    expect(res.status).toBe(422);
    const { error } = await read(res);
    expect(error.code).toBe('invalid_copier_config');
    expect(error.problems).toEqual(expect.arrayContaining(['The leader cannot also be a follower.']));
    expect(error.problems!.some((p) => p.includes('order size cap'))).toBe(true);
  });

  it("treats another customer's accounts as missing and hides their copiers", async () => {
    const b = accountIds.get('bob')!;
    const a = accountIds.get('alice')!;
    const res = await api.create(call('alice', { method: 'POST', body: { name: 'Steal', leaderAccountId: a.L, followers: [follower(b.A!)] }, key: 'grp-create-03' }));
    expect(res.status).toBe(422);
    expect((await read(res)).error.problems).toContain('A follower account was not found.');

    const bobGroup = await read(await api.create(call('bob', { method: 'POST', body: { name: 'Bob', leaderAccountId: b.L, followers: [follower(b.A!)] }, key: 'grp-create-04' })));
    expect((await api.get(call('alice'), bobGroup.group.id)).status).toBe(404);
    expect((await read(await api.list(call('alice')))).items.map((i) => i.id)).not.toContain(bobGroup.group.id);
  });

  it('requests activation asynchronously, replays duplicates and refuses stale or repeated requests', async () => {
    const a = accountIds.get('alice')!;
    const { group } = await read(await api.create(call('alice', { method: 'POST', body: { name: 'Activate me', leaderAccountId: a.L, followers: [follower(a.A!)] }, key: 'grp-create-05' })));

    const stale = await api.activate(call('alice', { method: 'POST', body: { expectedVersion: 2 }, key: 'grp-act-0001' }), group.id);
    expect(stale.status).toBe(409);
    expect((await read(stale)).error).toMatchObject({ code: 'config_version_conflict', currentVersion: 1 });

    const first = await api.activate(call('alice', { method: 'POST', body: { expectedVersion: 1 }, key: 'grp-act-0002' }), group.id);
    expect(first.status).toBe(202);
    expect((await read(first)).desiredState).toBe('ARMING');
    const replay = await read(await api.activate(call('alice', { method: 'POST', body: { expectedVersion: 1 }, key: 'grp-act-0002' }), group.id));
    expect(replay.replayed).toBe(true);

    const again = await api.activate(call('alice', { method: 'POST', body: { expectedVersion: 1 }, key: 'grp-act-0003' }), group.id);
    expect(again.status).toBe(409);
    expect((await read(again)).error.code).toBe('state_conflict');
  });

  it('requires sign-in', async () => {
    expect((await api.list(call(null))).status).toBe(401);
  });
});
