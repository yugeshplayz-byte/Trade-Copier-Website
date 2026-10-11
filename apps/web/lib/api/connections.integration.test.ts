import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, provisionUser, type Pool } from '@tradecopier/database';
import { migrate } from '@tradecopier/database/migrate';
import { createConnectionsApi } from './connections.ts';
import type { Principal, PrincipalResolver } from './principal.ts';

const adminUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && appUrl);
if (!enabled && process.env.REQUIRE_DB_TESTS === '1') {
  throw new Error('REQUIRE_DB_TESTS=1 but test database URLs are not set');
}

const ORIGIN = 'http://127.0.0.1:3000';

describe.skipIf(!enabled)('connections API (integration)', () => {
  let admin: Pool;
  let app: Pool;
  const principals = new Map<string, Principal>();
  const resolver: PrincipalResolver = async (r) => principals.get(r.headers.get('x-test-principal') ?? '') ?? null;
  let api: ReturnType<typeof createConnectionsApi>;

  function call(who: string | null, init: { method?: string; body?: unknown; key?: string; origin?: string } = {}) {
    const headers: Record<string, string> = { origin: init.origin ?? ORIGIN };
    if (who) headers['x-test-principal'] = who;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.key) headers['idempotency-key'] = init.key;
    return new Request(`${ORIGIN}/api/v1/connections`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  }

  interface Body {
    operationId?: string;
    replayed?: boolean;
    environment?: string;
    connection: { id: string; state: string };
    items: { id: string; label: string }[];
    error: Record<string, unknown>;
  }
  const read = async (res: Response) => (await res.json()) as Body;

  beforeAll(async () => {
    admin = createPool({ connectionString: adminUrl!, applicationName: 'tradeplex-conn-api-admin', max: 1 });
    await migrate(admin);
    app = createPool({ connectionString: appUrl!, applicationName: 'tradeplex-conn-api', max: 4 });
    const run = randomUUID();
    for (const name of ['alice', 'bob']) {
      const u = await provisionUser(app, `conn-api|${name}|${run}`, name);
      principals.set(name, { userId: u.userId, tenantId: u.tenantId, mfaVerified: false });
    }
    api = createConnectionsApi({ pool: async () => app, resolvePrincipal: resolver, allowedOrigins: [ORIGIN] });
  });

  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });

  it('accepts a simulated connection asynchronously and replays identical requests', async () => {
    const body = { provider: 'simulated', label: 'My simulator' };
    const first = await api.create(call('alice', { method: 'POST', body, key: 'conn-create-01' }));
    expect(first.status).toBe(202);
    const created = await read(first);
    expect(created.connection).toMatchObject({ state: 'CREATED' });
    const again = await read(await api.create(call('alice', { method: 'POST', body, key: 'conn-create-01' })));
    expect(again).toEqual({ ...created, replayed: true });
    const list = await read(await api.list(call('alice')));
    expect(list.items.filter((c) => c.label === 'My simulator')).toHaveLength(1);
    expect(list.environment).toBe('SIMULATED');
  });

  it('refuses real providers with the reason from the eligibility register', async () => {
    const tradovate = await api.create(call('alice', { method: 'POST', body: { provider: 'tradovate', label: 'Real' }, key: 'conn-create-02' }));
    expect(tradovate.status).toBe(422);
    expect((await read(tradovate)).error).toMatchObject({ code: 'provider_not_approved', providerStatus: 'NOT_APPROVED' });
    const topstep = await api.create(call('alice', { method: 'POST', body: { provider: 'topstepx', label: 'Real' }, key: 'conn-create-03' }));
    expect((await read(topstep)).error).toMatchObject({ providerStatus: 'BLOCKED' });
    const unknown = await api.create(call('alice', { method: 'POST', body: { provider: 'madeup', label: 'x' }, key: 'conn-create-04' }));
    expect(unknown.status).toBe(400);
  });

  it('keeps connections private to their tenant', async () => {
    const created = await read(
      await api.create(call('alice', { method: 'POST', body: { provider: 'simulated', label: 'Private' }, key: 'conn-create-05' })),
    );
    const id = created.connection.id;
    expect((await api.get(call('alice'), id)).status).toBe(200);
    expect((await api.get(call('bob'), id)).status).toBe(404);
    const bobList = await read(await api.list(call('bob')));
    expect(bobList.items.map((c) => c.id)).not.toContain(id);
  });

  it('requires sign-in, a same-origin request and an idempotency key', async () => {
    expect((await api.list(call(null))).status).toBe(401);
    expect((await api.create(call('alice', { method: 'POST', body: { provider: 'simulated', label: 'x' }, key: 'conn-create-06', origin: 'https://evil.example' }))).status).toBe(403);
    expect((await api.create(call('alice', { method: 'POST', body: { provider: 'simulated', label: 'x' } }))).status).toBe(400);
  });
});
