import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, provisionUser, type Pool } from '@tradecopier/database';
import { migrate } from '@tradecopier/database/migrate';
import type { Principal, PrincipalResolver } from './principal.ts';
import { createRiskProfileApi } from './risk-profiles.ts';
import { resolvePrincipal as productionResolver } from './principal.ts';

/*
 * API-level tenant isolation (ROADMAP Phase 2 acceptance: customer A cannot read
 * or mutate customer B's data through the API). Runs the real handlers against
 * the test database with the restricted runtime role. Identities are injected
 * through a test-only resolver, standing in for a verified provider session.
 */

const adminUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && appUrl);
if (!enabled && process.env.REQUIRE_DB_TESTS === '1') {
  throw new Error('REQUIRE_DB_TESTS=1 but test database URLs are not set');
}

const ORIGIN = 'http://127.0.0.1:3000';
const LIMITS = { maxAbsPosition: 4, maxOrderQuantity: 2, allowedProducts: ['MNQ'] };

describe.skipIf(!enabled)('risk profile API (integration)', () => {
  let admin: Pool;
  let app: Pool;
  const principals = new Map<string, Principal>();
  const testResolver: PrincipalResolver = async (request) => principals.get(request.headers.get('x-test-principal') ?? '') ?? null;
  let api: ReturnType<typeof createRiskProfileApi>;

  function call(principal: string | null, init: { method?: string; body?: unknown; key?: string; origin?: string | null } = {}) {
    const headers: Record<string, string> = {};
    if (principal) headers['x-test-principal'] = principal;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.key) headers['idempotency-key'] = init.key;
    if (init.origin !== null) headers['origin'] = init.origin ?? ORIGIN;
    return new Request(`${ORIGIN}/api/v1/risk-profiles`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  }

  async function body(res: Response): Promise<Record<string, unknown>> {
    return (await res.json()) as Record<string, unknown>;
  }

  beforeAll(async () => {
    admin = createPool({ connectionString: adminUrl!, applicationName: 'tradeplex-api-test-admin', max: 1 });
    await migrate(admin);
    app = createPool({ connectionString: appUrl!, applicationName: 'tradeplex-api-test', max: 4 });
    const run = randomUUID();
    for (const name of ['alice', 'bob']) {
      const user = await provisionUser(app, `api-test|${name}|${run}`, name);
      principals.set(name, { userId: user.userId, tenantId: user.tenantId, mfaVerified: true });
    }
    api = createRiskProfileApi({ pool: async () => app, resolvePrincipal: testResolver, allowedOrigins: [ORIGIN] });
  });

  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });

  it('the production resolver authenticates nobody until an identity provider is connected', async () => {
    const live = createRiskProfileApi({ pool: async () => app, resolvePrincipal: productionResolver, allowedOrigins: [ORIGIN] });
    expect((await live.list(call('alice'))).status).toBe(401);
  });

  it('requires authentication for every route', async () => {
    expect((await api.list(call(null))).status).toBe(401);
    expect((await api.get(call(null), randomUUID())).status).toBe(401);
    const create = await api.create(call(null, { method: 'POST', body: { name: 'x' }, key: 'unauth-key-1' }));
    expect(create.status).toBe(401);
    expect(await body(create)).toEqual({ error: { code: 'unauthenticated', message: 'Sign in to continue.' } });
  });

  it('refuses cross-site and origin-less mutations before doing anything', async () => {
    expect((await api.create(call('alice', { method: 'POST', body: { name: 'x' }, key: 'csrf-key-01', origin: 'https://evil.example' }))).status).toBe(403);
    expect((await api.create(call('alice', { method: 'POST', body: { name: 'x' }, key: 'csrf-key-02', origin: null }))).status).toBe(403);
    const list = await body(await api.list(call('alice')));
    expect((list.items as unknown[]).filter((i) => (i as { name: string }).name === 'x')).toHaveLength(0);
  });

  it('validates mutations and never accepts a client-supplied tenant ID', async () => {
    expect((await api.create(call('alice', { method: 'POST', body: { name: 'x' } }))).status).toBe(400); // no key
    const spoof = await api.create(
      call('alice', { method: 'POST', body: { name: 'x', tenantId: principals.get('bob')!.tenantId }, key: 'spoof-key-01' }),
    );
    expect(spoof.status).toBe(400);
    expect(JSON.stringify(await body(spoof))).not.toContain(principals.get('bob')!.tenantId);
  });

  it('creates once per idempotency key, replays identical requests and rejects reuse', async () => {
    const first = await api.create(call('alice', { method: 'POST', body: { name: 'Alice main' }, key: 'alice-create-1' }));
    expect(first.status).toBe(201);
    const created = await body(first);
    const replay = await api.create(call('alice', { method: 'POST', body: { name: 'Alice main' }, key: 'alice-create-1' }));
    expect(replay.status).toBe(200);
    expect(await body(replay)).toEqual({ ...created, replayed: true });
    const reuse = await api.create(call('alice', { method: 'POST', body: { name: 'Different' }, key: 'alice-create-1' }));
    expect(reuse.status).toBe(409);
    expect((await body(reuse)).error).toMatchObject({ code: 'idempotency_conflict' });
  });

  it('customer B cannot list, read or version customer A config through the API', async () => {
    const created = await body(await api.create(call('alice', { method: 'POST', body: { name: 'Alice private' }, key: 'alice-create-2' })));
    const aliceId = (created.profile as { id: string }).id;

    const bobList = await body(await api.list(call('bob')));
    expect((bobList.items as { id: string }[]).map((i) => i.id)).not.toContain(aliceId);
    expect((await api.get(call('bob'), aliceId)).status).toBe(404);
    const hijack = await api.publishVersion(
      call('bob', { method: 'POST', body: { expectedVersion: 0, limits: LIMITS }, key: 'bob-hijack-1' }),
      aliceId,
    );
    expect(hijack.status).toBe(404);

    const aliceView = await body(await api.get(call('alice'), aliceId));
    expect(aliceView.profile).toMatchObject({ id: aliceId, currentVersion: 0 });
  });

  it('publishes versions with optimistic concurrency and reports the current version on conflict', async () => {
    const created = await body(await api.create(call('alice', { method: 'POST', body: { name: 'Versioned' }, key: 'alice-create-3' })));
    const id = (created.profile as { id: string }).id;
    const ok = await api.publishVersion(call('alice', { method: 'POST', body: { expectedVersion: 0, limits: LIMITS }, key: 'alice-pub-0001' }), id);
    expect(ok.status).toBe(201);
    expect((await body(ok)).version).toBe(1);
    const stale = await api.publishVersion(call('alice', { method: 'POST', body: { expectedVersion: 0, limits: LIMITS }, key: 'alice-pub-0002' }), id);
    expect(stale.status).toBe(409);
    expect((await body(stale)).error).toMatchObject({ code: 'config_version_conflict', currentVersion: 1 });
    const invalid = await api.publishVersion(
      call('alice', { method: 'POST', body: { expectedVersion: 1, limits: { ...LIMITS, maxAbsPosition: 0 } }, key: 'alice-pub-0003' }),
      id,
    );
    expect(invalid.status).toBe(400);
  });

  it('returns 404, not 500, for malformed resource IDs', async () => {
    expect((await api.get(call('alice'), "1' OR '1'='1")).status).toBe(404);
  });
});
